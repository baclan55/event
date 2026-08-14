import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { userHasPermission } from '@/lib/roleAccess';
import { saveImage } from '@/lib/images';
import { renderBody, rawBodyForEdit, normalizeMarkdownSource } from '@/lib/richText';
import { writeAudit } from '@/lib/audit';
import { ok, parseId, readImage, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

function canSeeContentAudience(
  user: {
    is_owner?: boolean;
    is_event_helper?: boolean;
    is_administrator?: boolean;
  },
  audience: string,
) {
  if (audience === 'general') return true;
  if (audience === 'administrator') {
    return !!(user.is_owner || user.is_administrator);
  }
  if (audience === 'helper') {
    return !!(user.is_owner || user.is_event_helper || user.is_administrator);
  }
  return true;
}

export const handleContent: ApiHandler = async ({ key, request, params, method, body }) => {
  if (key.startsWith('content')) {
    const user = method === 'GET'
      ? await required(undefined, { allowIncompleteProfile: true })
      : await requiredPerm('edit_content', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const canSeeAuthor = user.is_owner
      || user.is_admin
      || !!user.is_administrator
      || userHasPermission(user, 'edit_content');
    const section = params.section;
    if (!['faq', 'regulations', 'first_steps'].includes(section)) {
      return jsonError('Неизвестный раздел.', 404);
    }
    const audienceValue = body.audience || request.nextUrl.searchParams.get('audience');
    const audience = ['helper', 'administrator', 'general'].includes(String(audienceValue))
      ? String(audienceValue)
      : 'general';
    if (key === 'content') {
      if (method === 'GET') {
        const result = await query<Record<string, unknown>>(
          'SELECT c.audience,c.body,c.image_id,c.updated_at,u.nickname AS updated_by_name FROM content_blocks c LEFT JOIN users u ON u.id=c.updated_by WHERE c.section=$1',
          [section],
        );
        const blocks = Object.fromEntries(
          result.rows
            .filter((row) => canSeeContentAudience(user, String(row.audience)))
            .map((row) => [
              row.audience as string,
              {
                body: renderBody(row.body),
                bodyRaw: rawBodyForEdit(row.body),
                imageId: row.image_id,
                updatedAt: row.updated_at,
                updatedBy: canSeeAuthor ? row.updated_by_name : null,
              },
            ]),
        );
        return NextResponse.json({ section, blocks });
      }
      await query(
        'INSERT INTO content_blocks(section,audience,body,updated_by,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(section,audience) DO UPDATE SET body=EXCLUDED.body,updated_by=EXCLUDED.updated_by,updated_at=now()',
        [section, audience, normalizeMarkdownSource(String(body.body || '')), user.id],
      );
      await writeAudit({
        actorId: user.id,
        action: 'content.update',
        entityType: 'content',
        entityId: `${section}:${audience}`,
      });
      return ok();
    }
    if (method === 'DELETE') {
      await query(
        'UPDATE content_blocks SET image_id=NULL,updated_by=$3,updated_at=now() WHERE section=$1 AND audience=$2',
        [section, audience, user.id],
      );
      await writeAudit({
        actorId: user.id,
        action: 'content.image.delete',
        entityType: 'content',
        entityId: `${section}:${audience}`,
      });
      return ok();
    }
    const file = await readImage(request);
    if (!file || file instanceof Error) return jsonError(file?.message || 'Файл не получен.', 400);
    const imageId = await saveImage(file);
    await query(
      "INSERT INTO content_blocks(section,audience,body,image_id,updated_by,updated_at) VALUES($1,$2,'',$3,$4,now()) ON CONFLICT(section,audience) DO UPDATE SET image_id=EXCLUDED.image_id,updated_by=EXCLUDED.updated_by,updated_at=now()",
      [section, audience, imageId, user.id],
    );
    await writeAudit({
      actorId: user.id,
      action: 'content.image.update',
      entityType: 'content',
      entityId: `${section}:${audience}`,
      details: { imageId },
    });
    return ok({ imageId });
  }

  if (key.startsWith('rule')) {
    const user = method === 'GET'
      ? await required()
      : await requiredPerm('edit_content', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    if (key === 'rules' && method === 'GET') {
      const result = await query<Record<string, unknown>>(
        `SELECT id,position,title,body,image_id,updated_at,
                COALESCE(archived, FALSE) AS archived
         FROM rules ORDER BY archived ASC, position,id`,
      );
      return NextResponse.json({
        rules: result.rows.map((row) => ({
          ...row,
          archived: !!row.archived,
          body: renderBody(row.body),
          bodyRaw: rawBodyForEdit(row.body),
        })),
      });
    }
    if (key === 'rules' && method === 'POST') {
      const title = String(body.title || '').trim();
      if (!title) return jsonError('Укажите заголовок правила.', 400);
      const next = await query<{ next: number }>('SELECT COALESCE(MAX(position),-1)+1 AS next FROM rules');
      const result = await query<{ id: number }>(
        'INSERT INTO rules(position,title,body) VALUES($1,$2,$3) RETURNING id',
        [next.rows[0].next, title, normalizeMarkdownSource(String(body.body || ''))],
      );
      await writeAudit({
        actorId: user.id,
        action: 'rule.create',
        entityType: 'rule',
        entityId: result.rows[0].id,
        details: { title },
      });
      return ok({ id: result.rows[0].id });
    }
    if (key === 'rules-reorder') {
      if (!Array.isArray(body.order)) return jsonError('order должен быть массивом id.', 400);
      await Promise.all(body.order.map((value, index) => query('UPDATE rules SET position=$1 WHERE id=$2', [index, value])));
      await writeAudit({
        actorId: user.id,
        action: 'rules.reorder',
        entityType: 'rule',
        details: { order: body.order },
      });
      return ok();
    }
    if (key === 'rule-image') {
      if (method === 'DELETE') {
        await query('UPDATE rules SET image_id=NULL,updated_at=now() WHERE id=$1', [parseId(params.id)]);
        await writeAudit({
          actorId: user.id,
          action: 'rule.image.delete',
          entityType: 'rule',
          entityId: params.id,
        });
        return ok();
      }
      const file = await readImage(request);
      if (!file || file instanceof Error) return jsonError(file?.message || 'Файл не получен.', 400);
      const imageId = await saveImage(file);
      await query('UPDATE rules SET image_id=$1,updated_at=now() WHERE id=$2', [imageId, parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'rule.image.update',
        entityType: 'rule',
        entityId: params.id,
        details: { imageId },
      });
      return ok({ imageId });
    }
    if (method === 'DELETE') {
      await query('DELETE FROM rules WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'rule.delete',
        entityType: 'rule',
        entityId: params.id,
      });
      return ok();
    }
    const title = String(body.title || '').trim();
    if (!title) return jsonError('Укажите заголовок правила.', 400);
    const archived = typeof body.archived === 'boolean' ? body.archived : null;
    if (archived == null) {
      await query('UPDATE rules SET title=$1,body=$2,updated_at=now() WHERE id=$3', [
        title,
        normalizeMarkdownSource(String(body.body || '')),
        parseId(params.id),
      ]);
    } else {
      await query(
        'UPDATE rules SET title=$1,body=$2,archived=$3,updated_at=now() WHERE id=$4',
        [
          title,
          normalizeMarkdownSource(String(body.body || '')),
          archived,
          parseId(params.id),
        ],
      );
    }
    await writeAudit({
      actorId: user.id,
      action: 'rule.update',
      entityType: 'rule',
      entityId: params.id,
      details: { title, ...(archived == null ? {} : { archived }) },
    });
    return ok();
  }

  return undefined;
};
