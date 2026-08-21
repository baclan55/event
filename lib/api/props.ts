import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { userHasPermission } from '@/lib/roleAccess';
import { saveImage } from '@/lib/images';
import { writeAudit } from '@/lib/audit';
import { ok, parseId, readImage, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

/** Каталог пропов: название, картинка и ID для спавна в игре. */
export const handleProps: ApiHandler = async ({ key, request, params, method, body }) => {
  if (!key.startsWith('prop')) return undefined;

  const user = method === 'GET'
    ? await requiredPerm('manage_props')
    : await requiredPerm('manage_props', { level: 'edit' });
  if (user instanceof NextResponse) return user;

  if (key === 'props' && method === 'GET') {
    const result = await query<Record<string, unknown>>(
      `SELECT p.id, p.name, p.spawn_id, p.image_id, p.updated_at,
              u.nickname AS created_by_name
       FROM props p
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.name ASC, p.id ASC`,
    );
    return NextResponse.json({
      props: result.rows,
      canEdit: userHasPermission(user, 'manage_props', 'edit'),
    });
  }

  if (key === 'props' && method === 'POST') {
    const name = String(body.name || '').trim();
    const spawnId = String(body.spawnId || '').trim();
    if (!name) return jsonError('Укажите название пропа.', 400);
    if (!spawnId) return jsonError('Укажите ID для спавна.', 400);
    const result = await query<{ id: number }>(
      'INSERT INTO props(name, spawn_id, created_by) VALUES($1,$2,$3) RETURNING id',
      [name, spawnId, user.id],
    );
    const newId = result.rows[0].id;
    await writeAudit({
      actorId: user.id,
      action: 'prop.create',
      entityType: 'prop',
      entityId: newId,
      details: { name, spawnId },
    });
    return ok({ id: newId });
  }

  if (key === 'prop-image') {
    if (method === 'DELETE') {
      await query('UPDATE props SET image_id=NULL, updated_at=now() WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'prop.image.delete',
        entityType: 'prop',
        entityId: params.id,
      });
      return ok();
    }
    const file = await readImage(request);
    if (!file || file instanceof Error) return jsonError(file?.message || 'Файл не получен.', 400);
    const imageId = await saveImage(file);
    await query('UPDATE props SET image_id=$1, updated_at=now() WHERE id=$2', [imageId, parseId(params.id)]);
    await writeAudit({
      actorId: user.id,
      action: 'prop.image.update',
      entityType: 'prop',
      entityId: params.id,
      details: { imageId },
    });
    return ok({ imageId });
  }

  if (key === 'prop') {
    if (method === 'DELETE') {
      await query('DELETE FROM props WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'prop.delete',
        entityType: 'prop',
        entityId: params.id,
      });
      return ok();
    }
    const name = String(body.name || '').trim();
    const spawnId = String(body.spawnId || '').trim();
    if (!name) return jsonError('Укажите название пропа.', 400);
    if (!spawnId) return jsonError('Укажите ID для спавна.', 400);
    await query(
      'UPDATE props SET name=$1, spawn_id=$2, updated_at=now() WHERE id=$3',
      [name, spawnId, parseId(params.id)],
    );
    await writeAudit({
      actorId: user.id,
      action: 'prop.update',
      entityType: 'prop',
      entityId: params.id,
      details: { name, spawnId },
    });
    return ok();
  }

  return undefined;
};
