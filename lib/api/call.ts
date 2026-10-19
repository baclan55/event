import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { userHasPermission } from '@/lib/roleAccess';
import { CALL_QUESTIONS_COUNT, isCallScore } from '@/lib/callTemplate';
import { loadCallSheet } from '@/lib/callSheet';
import { ok, parseId, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

const CATEGORY_MAX = 80;
const QUESTION_MAX = 1000;
const ANSWER_MAX = 2000;

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Обзвон кандидатов: база вопросов (категории + вопросы с ответами), лист и оценки. Права — как у «Кандидатов». */
export const handleCall: ApiHandler = async ({ key, params, method, body }) => {
  if (!key.startsWith('call-')) return undefined;

  const user = method === 'GET'
    ? await requiredPerm('candidates')
    : await requiredPerm('candidates', { level: 'edit' });
  if (user instanceof NextResponse) return user;

  if (key === 'call-sheet' && method === 'GET') {
    return NextResponse.json(await loadCallSheet());
  }

  // «Перемешать вопросы»: новый общий лист из N случайных вопросов базы, прошлые оценки сбрасываются.
  if (key === 'call-shuffle' && method === 'POST') {
    const all = await query<{ id: number }>('SELECT id FROM call_questions');
    if (!all.rows.length) return jsonError('В базе вопросов пока пусто — сначала добавьте вопросы.', 400);
    const picked = shuffled(all.rows.map((r) => r.id)).slice(0, CALL_QUESTIONS_COUNT);
    await query(
      `WITH del AS (DELETE FROM call_sheet_questions)
       INSERT INTO call_sheet_questions(position, question_id, category_name, question, answer)
       SELECT t.ord, q.id, COALESCE(c.name, ''), q.question, q.answer
       FROM unnest($1::int[]) WITH ORDINALITY AS t(qid, ord)
       JOIN call_questions q ON q.id = t.qid
       LEFT JOIN call_categories c ON c.id = q.category_id`,
      [picked],
    );
    await writeAudit({
      actorId: user.id,
      action: 'call.shuffle',
      entityType: 'call_sheet',
      entityId: null,
      details: { count: picked.length },
    });
    return NextResponse.json({ ok: true, ...(await loadCallSheet()) });
  }

  // Оценка одного кандидата за один вопрос листа: 1 / 0.5 / 0, null — снять оценку.
  if (key === 'call-score' && method === 'PUT') {
    const applicationId = Number(body.applicationId);
    const sheetQuestionId = Number(body.sheetQuestionId);
    if (!Number.isInteger(applicationId) || !Number.isInteger(sheetQuestionId)) {
      return jsonError('Некорректные данные.', 400);
    }
    const exists = await query('SELECT 1 FROM call_sheet_questions WHERE id=$1', [sheetQuestionId]);
    if (!exists.rows[0]) return jsonError('Этого вопроса уже нет в листе — лист был перемешан. Обновите страницу.', 404);
    const app = await query(`SELECT 1 FROM applications WHERE id=$1 AND status='approved'`, [applicationId]);
    if (!app.rows[0]) return jsonError('Кандидат не найден.', 404);

    if (body.score === null) {
      await query(
        'DELETE FROM call_scores WHERE sheet_question_id=$1 AND application_id=$2',
        [sheetQuestionId, applicationId],
      );
      return ok();
    }
    const score = Number(body.score);
    if (!isCallScore(score)) return jsonError('Оценка может быть только 1, 0.5 или 0.', 400);
    await query(
      `INSERT INTO call_scores(sheet_question_id, application_id, score)
       VALUES($1,$2,$3)
       ON CONFLICT (sheet_question_id, application_id)
       DO UPDATE SET score=EXCLUDED.score, updated_at=now()`,
      [sheetQuestionId, applicationId, score],
    );
    return ok();
  }

  // База вопросов целиком.
  if (key === 'call-bank' && method === 'GET') {
    const [categories, questions] = await Promise.all([
      query(
        `SELECT c.id, c.name, count(q.id)::int AS question_count
         FROM call_categories c LEFT JOIN call_questions q ON q.category_id = c.id
         GROUP BY c.id ORDER BY lower(c.name) ASC`,
      ),
      query(
        `SELECT q.id, q.category_id, c.name AS category_name, q.question, q.answer
         FROM call_questions q LEFT JOIN call_categories c ON c.id = q.category_id
         ORDER BY q.id ASC`,
      ),
    ]);
    return NextResponse.json({
      categories: categories.rows,
      questions: questions.rows,
      canEdit: userHasPermission(user, 'candidates', 'edit'),
    });
  }

  if (key === 'call-categories' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) return jsonError('Укажите название категории.', 400);
    if (name.length > CATEGORY_MAX) return jsonError(`Название слишком длинное (максимум ${CATEGORY_MAX} символов).`, 400);
    const dup = await query('SELECT 1 FROM call_categories WHERE lower(name)=lower($1)', [name]);
    if (dup.rows[0]) return jsonError('Категория с таким названием уже есть.', 400);
    const result = await query<{ id: number }>(
      'INSERT INTO call_categories(name) VALUES($1) RETURNING id',
      [name],
    );
    await writeAudit({
      actorId: user.id,
      action: 'call.category.create',
      entityType: 'call_category',
      entityId: result.rows[0].id,
      details: { name },
    });
    return ok({ id: result.rows[0].id });
  }

  if (key === 'call-category') {
    const id = parseId(params.id);
    if (!Number.isInteger(id)) return jsonError('Некорректная категория.', 400);
    if (method === 'PUT') {
      const name = String(body.name || '').trim();
      if (!name) return jsonError('Укажите название категории.', 400);
      if (name.length > CATEGORY_MAX) return jsonError(`Название слишком длинное (максимум ${CATEGORY_MAX} символов).`, 400);
      const dup = await query('SELECT 1 FROM call_categories WHERE lower(name)=lower($1) AND id<>$2', [name, id]);
      if (dup.rows[0]) return jsonError('Категория с таким названием уже есть.', 400);
      const updated = await query('UPDATE call_categories SET name=$1 WHERE id=$2 RETURNING id', [name, id]);
      if (!updated.rows[0]) return jsonError('Категория не найдена.', 404);
      await writeAudit({
        actorId: user.id,
        action: 'call.category.update',
        entityType: 'call_category',
        entityId: id,
        details: { name },
      });
      return ok();
    }
    if (method === 'DELETE') {
      // Вопросы остаются в базе — просто без категории (ON DELETE SET NULL).
      const removed = await query('DELETE FROM call_categories WHERE id=$1 RETURNING name', [id]);
      if (!removed.rows[0]) return jsonError('Категория не найдена.', 404);
      await writeAudit({
        actorId: user.id,
        action: 'call.category.delete',
        entityType: 'call_category',
        entityId: id,
        details: { name: removed.rows[0].name },
      });
      return ok();
    }
  }

  if (key === 'call-questions' && method === 'POST') {
    const parsed = await parseQuestionBody(body);
    if (parsed instanceof NextResponse) return parsed;
    const result = await query<{ id: number }>(
      `INSERT INTO call_questions(category_id, question, answer, created_by)
       VALUES($1,$2,$3,$4) RETURNING id`,
      [parsed.categoryId, parsed.question, parsed.answer, user.id],
    );
    await writeAudit({
      actorId: user.id,
      action: 'call.question.create',
      entityType: 'call_question',
      entityId: result.rows[0].id,
      details: { question: parsed.question, categoryId: parsed.categoryId },
    });
    return ok({ id: result.rows[0].id });
  }

  if (key === 'call-question') {
    const id = parseId(params.id);
    if (!Number.isInteger(id)) return jsonError('Некорректный вопрос.', 400);
    if (method === 'PUT') {
      const parsed = await parseQuestionBody(body);
      if (parsed instanceof NextResponse) return parsed;
      const updated = await query(
        `UPDATE call_questions SET category_id=$1, question=$2, answer=$3, updated_at=now()
         WHERE id=$4 RETURNING id`,
        [parsed.categoryId, parsed.question, parsed.answer, id],
      );
      if (!updated.rows[0]) return jsonError('Вопрос не найден.', 404);
      await writeAudit({
        actorId: user.id,
        action: 'call.question.update',
        entityType: 'call_question',
        entityId: id,
        details: { question: parsed.question, categoryId: parsed.categoryId },
      });
      return ok();
    }
    if (method === 'DELETE') {
      const removed = await query('DELETE FROM call_questions WHERE id=$1 RETURNING question', [id]);
      if (!removed.rows[0]) return jsonError('Вопрос не найден.', 404);
      await writeAudit({
        actorId: user.id,
        action: 'call.question.delete',
        entityType: 'call_question',
        entityId: id,
        details: { question: removed.rows[0].question },
      });
      return ok();
    }
  }

  return jsonError('Метод не поддерживается.', 405);
};

async function parseQuestionBody(body: Record<string, unknown>) {
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();
  if (!question) return jsonError('Введите текст вопроса.', 400);
  if (!answer) return jsonError('Введите ответ на вопрос.', 400);
  if (question.length > QUESTION_MAX) return jsonError(`Вопрос слишком длинный (максимум ${QUESTION_MAX} символов).`, 400);
  if (answer.length > ANSWER_MAX) return jsonError(`Ответ слишком длинный (максимум ${ANSWER_MAX} символов).`, 400);
  let categoryId: number | null = null;
  if (body.categoryId !== null && body.categoryId !== undefined && body.categoryId !== '') {
    categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId)) return jsonError('Некорректная категория.', 400);
    const exists = await query('SELECT 1 FROM call_categories WHERE id=$1', [categoryId]);
    if (!exists.rows[0]) return jsonError('Категория не найдена.', 404);
  }
  return { question, answer, categoryId };
}
