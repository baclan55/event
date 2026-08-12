import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser, type PublicUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { renderBody } from '@/lib/richText';
import { getRolesForUsers } from '@/lib/roles';
import { tierForPriority } from '@/lib/tier';

export async function requirePortalUser(): Promise<PublicUser> {
  const user = publicUser(await getCurrentUser());
  if (!user) redirect('/');
  return user;
}

export async function loadDashboard() {
  const r = await query<Record<string, unknown>>(
    `SELECT u.id, u.nickname, u.avatar_url, u.weekly_events, r.name AS role_name, r.priority AS role_priority
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY COALESCE(r.priority, 999), u.nickname`
  );
  const roles = await getRolesForUsers(r.rows.map((x) => x.id as number));
  const members = r.rows.map((x) => ({
    ...x,
    roles: roles.get(x.id as number) || [],
  }));
  const target = Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
  return { members, target };
}

export async function loadReprimandsMe(userId: number) {
  try {
    // Не выбираем новые служебные колонки (converted и т.п.): профиль должен
    // работать и до применения последней миграции схемы.
    const r = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at,
              ib.nickname AS issued_by_nickname
       FROM reprimands rp
       LEFT JOIN users ib ON ib.id = rp.issued_by
       WHERE rp.user_id = $1
       ORDER BY rp.created_at DESC`,
      [userId]
    );
    return r.rows;
  } catch (error) {
    console.error('[cabinet] Не удалось загрузить выговоры профиля:', (error as Error).message);
    return [];
  }
}

export async function loadContent(section: string) {
  const r = await query<Record<string, unknown>>(
    `SELECT c.audience, c.body, c.image_id, c.updated_at, u.nickname AS updated_by_name
     FROM content_blocks c
     LEFT JOIN users u ON u.id = c.updated_by
     WHERE c.section = $1`,
    [section]
  );
  return Object.fromEntries(
    r.rows.map((x) => [
      x.audience as string,
      {
        body: renderBody(x.body),
        imageId: x.image_id as number | null,
        updatedBy: x.updated_by_name as string | null,
      },
    ])
  );
}

export async function loadRules() {
  const r = await query<Record<string, unknown>>(
    `SELECT id, position, title, body, image_id, updated_at FROM rules ORDER BY position, id`
  );
  return r.rows.map((x) => ({ ...x, bodyHtml: renderBody(x.body) }));
}

export async function loadRoster() {
  const r = await query<Record<string, unknown>>(
    `SELECT u.id, u.nickname, u.discord_username, u.avatar_url, u.weekly_events, u.note,
            u.role_id, r.name AS role_name, r.priority AS role_priority
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY COALESCE(r.priority, 999), u.nickname`
  );
  const rolesMap = await getRolesForUsers(r.rows.map((x) => x.id as number));
  const allRoles = await query('SELECT id, name, priority FROM roles ORDER BY priority');
  return {
    members: r.rows.map((x) => ({
      ...x,
      tier: tierForPriority(x.role_priority as number),
      roles: rolesMap.get(x.id as number) || [],
    })),
    roles: allRoles.rows,
    target: Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5,
  };
}

export async function loadVacations() {
  const r = await query<Record<string, unknown>>(
    `SELECT v.id, v.user_id, v.start_date, v.end_date, v.reason, v.status, v.created_at,
            u.nickname, u.avatar_url
     FROM vacations v
     JOIN users u ON u.id = v.user_id
     ORDER BY v.start_date`
  );
  return r.rows;
}

export async function loadApplications() {
  const r = await query<Record<string, unknown>>(
    `SELECT * FROM applications ORDER BY created_at DESC LIMIT 100`
  );
  return r.rows;
}

export async function loadCandidates() {
  const r = await query<Record<string, unknown>>(
    `SELECT a.id, a.applicant_name, a.discord, a.nickname_static, a.status, a.created_at, a.candidate_user_id
     FROM applications a WHERE a.status='approved' ORDER BY a.created_at ASC`
  );
  return r.rows;
}

export async function loadReprimandsAdmin() {
  const reprimands = await query<Record<string, unknown>>(
    `SELECT rp.id, rp.reason, rp.type, rp.created_at, u.nickname AS user_nickname
     FROM reprimands rp JOIN users u ON u.id = rp.user_id
     ORDER BY rp.created_at DESC LIMIT 100`
  );
  const members = await query<{ id: number; nickname: string }>(
    `SELECT id, nickname FROM users ORDER BY nickname`
  );
  return { reprimands: reprimands.rows, members: members.rows };
}

export async function loadOwnerUsers() {
  const r = await query<Record<string, unknown>>(
    `SELECT u.id, u.nickname, u.avatar_url, u.is_admin, u.is_owner
     FROM users u ORDER BY u.nickname`
  );
  const rolesMap = await getRolesForUsers(r.rows.map((x) => x.id as number));
  return {
    users: r.rows.map((x) => ({ ...x, roles: rolesMap.get(x.id as number) || [] })),
  };
}

export function fmtDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}
