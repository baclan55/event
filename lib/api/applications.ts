import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, jsonError } from '@/lib/auth';
import { addUserRole } from '@/lib/roles';
import { DEFAULT_CLOSED_MESSAGE, writeAudit } from '@/lib/audit';
import { ok, parseId, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

const CLOSED_MESSAGE_MAX = 280;

async function releaseCandidate(userId: number | null) {
  if (!userId) return;
  const { rows } = await query<{ discord_username: string | null; login: string | null }>(
    'SELECT discord_username, login FROM users WHERE id=$1',
    [userId],
  );
  if (!rows[0]) return;
  if (!rows[0].discord_username && !rows[0].login) {
    await query('DELETE FROM users WHERE id=$1', [userId]);
  } else {
    await query(`UPDATE users SET status='member' WHERE id=$1`, [userId]);
  }
}

async function notifyDiscord(text: string) {
  const url = process.env.APPLICATIONS_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Webhook failures do not affect application processing.
  }
}

export const handleApplications: ApiHandler = async ({ key, params, method, body }) => {
  if (!key.startsWith('application') && key !== 'candidates') return undefined;

  if (key === 'applications-status') {
    if (method === 'GET') {
      const settings = await query<{ is_open: boolean; closed_message: string | null }>(
        'SELECT is_open, closed_message FROM applications_settings WHERE id=1',
      );
      return NextResponse.json({
        isOpen: settings.rows[0]?.is_open ?? true,
        closedMessage: settings.rows[0]?.closed_message || DEFAULT_CLOSED_MESSAGE,
      });
    }
    if (method === 'PUT') {
      const user = await requiredPerm('applications');
      if (user instanceof NextResponse) return user;
      const current = await query<{ is_open: boolean; closed_message: string | null }>(
        'SELECT is_open, closed_message FROM applications_settings WHERE id=1',
      );
      const isOpen = typeof body.isOpen === 'boolean' || body.isOpen === 'true' || body.isOpen === 'false'
        ? body.isOpen === true || body.isOpen === 'true'
        : (current.rows[0]?.is_open ?? true);
      let closedMessage = current.rows[0]?.closed_message || DEFAULT_CLOSED_MESSAGE;
      if (typeof body.closedMessage === 'string') {
        closedMessage = body.closedMessage.trim() || DEFAULT_CLOSED_MESSAGE;
        if (closedMessage.length > CLOSED_MESSAGE_MAX) {
          return jsonError(`Сообщение слишком длинное (максимум ${CLOSED_MESSAGE_MAX} символов).`, 400);
        }
      }
      await query(
        `INSERT INTO applications_settings (id, is_open, closed_message, updated_by, updated_at)
         VALUES (1, $1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET
           is_open=EXCLUDED.is_open,
           closed_message=EXCLUDED.closed_message,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()`,
        [isOpen, closedMessage, user.id],
      );
      if (typeof body.isOpen === 'boolean' || body.isOpen === 'true' || body.isOpen === 'false') {
        await writeAudit({
          actorId: user.id,
          action: isOpen ? 'applications.open' : 'applications.close',
          entityType: 'applications_settings',
          entityId: 1,
          details: { isOpen, closedMessage },
        });
      } else if (typeof body.closedMessage === 'string') {
        await writeAudit({
          actorId: user.id,
          action: 'applications.message',
          entityType: 'applications_settings',
          entityId: 1,
          details: { closedMessage },
        });
      }
      return ok({ isOpen, closedMessage });
    }
    return jsonError('Метод не поддерживается.', 405);
  }

  if (key === 'candidates') {
    const user = await requiredPerm('candidates');
    if (user instanceof NextResponse) return user;
    const result = await query(
      `SELECT a.id, a.applicant_name, a.discord, a.nickname_static, a.status, a.created_at,
        a.candidate_user_id, cu.nickname AS candidate_nickname, cu.avatar_image_id AS candidate_avatar_image_id,
        cu.avatar_url AS candidate_avatar_url, rb.nickname AS reviewed_by_nickname
        FROM applications a
        LEFT JOIN users cu ON cu.id=a.candidate_user_id
        LEFT JOIN users rb ON rb.id=a.reviewed_by
        WHERE a.status='approved' ORDER BY a.created_at ASC`,
    );
    return NextResponse.json({ candidates: result.rows });
  }
  if (key === 'application-call') {
    const user = await requiredPerm('candidates');
    if (user instanceof NextResponse) return user;
    const passed = body.passed === true || body.passed === 'true';
    const { rows } = await query<Record<string, unknown>>('SELECT * FROM applications WHERE id=$1', [
      parseId(params.id),
    ]);
    const application = rows[0];
    if (!application) return jsonError('Заявка не найдена.', 404);
    if (application.status !== 'approved') {
      return jsonError('Обзвон доступен только для одобренных заявок.', 400);
    }
    if (passed) {
      if (application.candidate_user_id) {
        await query(`UPDATE users SET status='member' WHERE id=$1`, [application.candidate_user_id]);
        await addUserRole(application.candidate_user_id as number, 'Mini Event Helper');
      }
      await query(`UPDATE applications SET status='call_passed' WHERE id=$1`, [parseId(params.id)]);
    } else {
      await releaseCandidate(application.candidate_user_id as number | null);
      await query(`UPDATE applications SET status='call_failed', candidate_user_id=NULL WHERE id=$1`, [
        parseId(params.id),
      ]);
    }
    await writeAudit({
      actorId: user.id,
      action: passed ? 'application.call_passed' : 'application.call_failed',
      entityType: 'application',
      entityId: params.id,
      details: { candidateUserId: application.candidate_user_id },
    });
    return ok({ passed });
  }
  if (key === 'application' && method === 'DELETE') {
    const user = await requiredPerm('applications');
    if (user instanceof NextResponse) return user;
    const { rows } = await query<{ status: string; candidate_user_id: number | null }>(
      'SELECT status, candidate_user_id FROM applications WHERE id=$1',
      [parseId(params.id)],
    );
    if (!rows[0]) return jsonError('Заявка не найдена.', 404);
    await releaseCandidate(rows[0].candidate_user_id);
    await query('DELETE FROM applications WHERE id=$1', [parseId(params.id)]);
    await writeAudit({
      actorId: user.id,
      action: 'application.delete',
      entityType: 'application',
      entityId: params.id,
      details: { status: rows[0].status, candidateUserId: rows[0].candidate_user_id },
    });
    return ok();
  }
  if (key === 'application' && method === 'PUT') {
    const user = await requiredPerm('applications');
    if (user instanceof NextResponse) return user;
    const status = String(body.status || '');
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return jsonError('Некорректный статус.', 400);
    }
    const { rows } = await query<Record<string, unknown>>('SELECT * FROM applications WHERE id=$1', [
      parseId(params.id),
    ]);
    const application = rows[0];
    if (!application) return jsonError('Заявка не найдена.', 404);
    let candidateId = (application.candidate_user_id || application.applicant_id) as number | null;
    if (status === 'approved') {
      const discordId = String(application.discord || '');
      if (!candidateId && discordId) {
        const existing = await query<{ id: number }>('SELECT id FROM users WHERE discord_id=$1', [discordId]);
        if (existing.rows[0]) {
          candidateId = existing.rows[0].id;
        } else {
          const newUser = await query<{ id: number }>(
            `INSERT INTO users (nickname, status, discord_id) VALUES ($1,'candidate',$2) RETURNING id`,
            [application.nickname_static || application.applicant_name || discordId, discordId],
          );
          candidateId = newUser.rows[0].id;
        }
      }
      if (!candidateId) {
        return jsonError('Нельзя одобрить заявку без связанного Discord-пользователя.', 400);
      }
      await query(`UPDATE users SET status='candidate' WHERE id=$1`, [candidateId]);
      await query('UPDATE applications SET status=$1, reviewed_by=$2, candidate_user_id=$3 WHERE id=$4', [
        status,
        user.id,
        candidateId,
        parseId(params.id),
      ]);
      await notifyDiscord(`Заявка #${params.id} одобрена. Discord: ${application.discord}`);
    } else {
      if (application.candidate_user_id) {
        await releaseCandidate(application.candidate_user_id as number);
      }
      await query('UPDATE applications SET status=$1, reviewed_by=$2, candidate_user_id=NULL WHERE id=$3', [
        status,
        user.id,
        parseId(params.id),
      ]);
    }
    await writeAudit({
      actorId: user.id,
      action: `application.${status}`,
      entityType: 'application',
      entityId: params.id,
      details: { candidateUserId: candidateId },
    });
    return ok({ status });
  }
  if (method === 'GET') {
    const user = await requiredPerm('applications');
    if (user instanceof NextResponse) return user;
    const result = await query(
      `SELECT a.*, rb.nickname AS reviewed_by_nickname
        FROM applications a LEFT JOIN users rb ON rb.id=a.reviewed_by
        ORDER BY a.created_at DESC`,
    );
    const settings = await query<{ is_open: boolean; closed_message: string | null }>(
      'SELECT is_open, closed_message FROM applications_settings WHERE id=1',
    );
    return NextResponse.json({
      applications: result.rows,
      isOpen: settings.rows[0]?.is_open ?? true,
      closedMessage: settings.rows[0]?.closed_message || DEFAULT_CLOSED_MESSAGE,
    });
  }

  const user = await getCurrentUser();
  if (!user?.discord_id) return jsonError('Для подачи заявки войдите через Discord.', 401);
  const settings = await query<{ is_open: boolean }>('SELECT is_open FROM applications_settings WHERE id=1');
  if (settings.rows[0] && settings.rows[0].is_open === false) {
    return jsonError('Набор сейчас закрыт.', 403);
  }
  const fields = {
    nicknameStatic: String(body.nicknameStatic || '').trim(),
    age: String(body.age || '').trim(),
    avgOnline: String(body.avgOnline || '').trim(),
    timePeriod: String(body.timePeriod || '').trim(),
    experience: String(body.experience || '').trim(),
    ideas: String(body.ideas || '').trim(),
    motivation: String(body.motivation || '').trim(),
  };
  if (Object.values(fields).some((value) => !value)) {
    return jsonError('Заполните все поля анкеты.', 400);
  }
  if (!(body.consent === true || body.consent === 'true')) {
    return jsonError('Нужно согласие на обработку персональных данных.', 400);
  }
  const pending = await query('SELECT id FROM applications WHERE status=$1 AND discord=$2 LIMIT 1', [
    'pending',
    user.discord_id,
  ]);
  if (pending.rows[0]) return jsonError('У вас уже есть заявка на рассмотрении.', 400);
  const result = await query<{ id: number }>(
    `INSERT INTO applications (applicant_id, applicant_name, discord, nickname_static, age, avg_online, time_period, experience, ideas, motivation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      user.id,
      fields.nicknameStatic || user.discord_username || user.discord_id,
      user.discord_id,
      fields.nicknameStatic,
      fields.age,
      fields.avgOnline,
      fields.timePeriod,
      fields.experience,
      fields.ideas,
      fields.motivation,
    ],
  );
  await notifyDiscord(`Новая заявка #${result.rows[0].id} от ${user.discord_username || user.discord_id}`);
  return ok({ id: result.rows[0].id });
};
