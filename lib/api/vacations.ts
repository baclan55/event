import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { userHasPermission } from '@/lib/roleAccess';
import { writeAudit } from '@/lib/audit';
import { ok, parseId, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

export const handleVacations: ApiHandler = async ({ key, params, method, body }) => {
  if (key !== 'vacations-mine' && key !== 'vacations' && key !== 'vacation') return undefined;

  const user = await required();
  if (user instanceof NextResponse) return user;
  const fields =
    'v.id,v.user_id,v.start_date,v.end_date,v.reason,v.status,v.created_at,v.reviewed_by,v.reviewed_at,u.nickname,u.avatar_image_id,u.avatar_url,rb.nickname reviewed_by_nickname';
  if (key === 'vacations-mine') {
    const result = await query(
      `SELECT ${fields} FROM vacations v JOIN users u ON u.id=v.user_id LEFT JOIN users rb ON rb.id=v.reviewed_by WHERE v.user_id=$1 ORDER BY v.created_at DESC`,
      [user.id],
    );
    return NextResponse.json({ vacations: result.rows });
  }
  if (key === 'vacations' && method === 'GET') {
    const result = await query<Record<string, unknown>>(
      `SELECT ${fields} FROM vacations v JOIN users u ON u.id=v.user_id LEFT JOIN users rb ON rb.id=v.reviewed_by ORDER BY v.start_date`,
    );
    const mine = result.rows.filter((row) => row.user_id === user.id);
    const canReview = userHasPermission(user, 'vacations_review');
    return NextResponse.json({
      vacations: result.rows.map((row) => ({
        ...row,
        reason: user.is_owner || user.id === row.user_id || canReview ? row.reason : '',
      })),
      mine,
    });
  }
  if (key === 'vacations') {
    const start = String(body.startDate || '');
    const end = String(body.endDate || '');
    const reason = String(body.reason || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      return jsonError('Укажите корректный период отпуска.', 400);
    }
    if (reason.length > 500) return jsonError('Причина слишком длинная (максимум 500 символов).', 400);
    const result = await query<{ id: number }>(
      'INSERT INTO vacations(user_id,start_date,end_date,reason) VALUES($1,$2,$3,$4) RETURNING id',
      [user.id, start, end, reason],
    );
    await writeAudit({
      actorId: user.id,
      action: 'vacation.create',
      entityType: 'vacation',
      entityId: result.rows[0].id,
      details: { start, end },
    });
    return ok({ id: result.rows[0].id });
  }
  if (method === 'DELETE') {
    const reviewer = await requiredPerm('vacations_review');
    if (reviewer instanceof NextResponse) return reviewer;
    const target = await query<{ user_id: number; status: string }>(
      'SELECT user_id,status FROM vacations WHERE id=$1',
      [parseId(params.id)],
    );
    await query('DELETE FROM vacations WHERE id=$1', [parseId(params.id)]);
    await writeAudit({
      actorId: reviewer.id,
      action: 'vacation.delete',
      entityType: 'vacation',
      entityId: params.id,
      details: target.rows[0] ? { userId: target.rows[0].user_id, status: target.rows[0].status } : {},
    });
    return ok();
  }
  const vacation = await query<{ user_id: number; status: string }>(
    'SELECT user_id,status FROM vacations WHERE id=$1',
    [parseId(params.id)],
  );
  if (!vacation.rows[0]) return jsonError('Заявка не найдена.', 404);
  const status = String(body.status);
  if (!['approved', 'rejected', 'cancelled'].includes(status)) {
    return jsonError('Некорректный статус заявки.', 400);
  }
  const reviewer = userHasPermission(user, 'vacations_review');
  const ownPendingCancellation =
    status === 'cancelled' && vacation.rows[0].user_id === user.id && vacation.rows[0].status === 'pending';
  if (!reviewer && !ownPendingCancellation) {
    return jsonError('Недостаточно прав для рассмотрения заявок на отпуск.', 403);
  }
  if (vacation.rows[0].status !== 'pending' && status !== 'cancelled') {
    return jsonError('Рассмотренную заявку нельзя изменить повторно.', 400);
  }
  await query('UPDATE vacations SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3', [
    status,
    reviewer ? user.id : null,
    parseId(params.id),
  ]);
  await writeAudit({
    actorId: user.id,
    action: `vacation.${status}`,
    entityType: 'vacation',
    entityId: params.id,
    details: { userId: vacation.rows[0].user_id, previousStatus: vacation.rows[0].status },
  });
  return ok();
};
