import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { APPLICATIONS_ROLES, VACATIONS_REVIEW_ROLES, userHasRoleIn } from '@/lib/roleAccess';
import { writeAudit } from '@/lib/audit';
import { ok, parseId, required } from './helpers';
import type { ApiHandler } from './types';

export const handleVacations: ApiHandler = async ({ key, params, method, body }) => {
  if (key === 'applications-status') {
    if (method === 'GET') {
      const result = await query<{ is_open: boolean }>('SELECT is_open FROM applications_settings WHERE id=1');
      return NextResponse.json({ isOpen: result.rows[0]?.is_open ?? true });
    }
    const user = await required(APPLICATIONS_ROLES);
    if (user instanceof NextResponse) return user;
    const isOpen = body.isOpen === true || body.isOpen === 'true';
    await query('UPDATE applications_settings SET is_open=$1,updated_by=$2,updated_at=now() WHERE id=1', [
      isOpen,
      user.id,
    ]);
    await writeAudit({
      actorId: user.id,
      action: 'applications.recruitment',
      entityType: 'applications_settings',
      entityId: 1,
      details: { isOpen },
    });
    return ok({ isOpen });
  }

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
    return NextResponse.json({
      vacations: result.rows.map((row) => ({
        ...row,
        reason:
          user.is_owner || user.id === row.user_id || userHasRoleIn(user, VACATIONS_REVIEW_ROLES)
            ? row.reason
            : '',
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
    const reviewer = await required(VACATIONS_REVIEW_ROLES);
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
  const reviewer = userHasRoleIn(user, VACATIONS_REVIEW_ROLES);
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
