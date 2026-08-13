import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import type { PublicUser } from '@/lib/authShared';
import { query } from '@/lib/db';
import { rawBodyForEdit, renderBody } from '@/lib/richText';
import { getRolesForUsers } from '@/lib/roles';
import { tierForPriority } from '@/lib/tier';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
import { ADMIN_POINT_DECAY_DAYS, adminPointActive } from '@/lib/reprimandRules';
import { DEFAULT_CLOSED_MESSAGE } from '@/lib/audit';
import { abandonStaleOpenGathers } from '@/lib/discordGatherCleanup';
import { sqlCountWeeklyMpSubquery, syncWeeklyEventsForUser, weekTimeZone } from '@/lib/weekBounds';
import { weeklyTargetForUser, weeklyTargetsByRoleId } from '@/lib/weeklyTarget';

export { fmtDate } from '@/lib/formatDate';

export async function requirePortalUser(): Promise<PublicUser> {
  const user = publicUser(await getCurrentUser());
  if (!user) redirect('/');
  return user;
}

export async function loadDashboard() {
  const tz = weekTimeZone();
  const weekCountSql = sqlCountWeeklyMpSubquery('u.discord_id', 1);
  const r = await query<Record<string, unknown>>(
    `SELECT u.id, u.nickname, u.avatar_image_id, u.avatar_url,
            CASE WHEN u.discord_id IS NULL THEN 0 ELSE COALESCE(${weekCountSql}, 0) END AS weekly_events,
            u.role_id, u.status, r.name AS role_name, r.priority AS role_priority,
            r.weekly_events_target
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY COALESCE(r.priority, 999), u.nickname`,
    [tz],
  );
  const roles = await getRolesForUsers(r.rows.map((x) => x.id as number));
  const targets = await weeklyTargetsByRoleId();
  const members = r.rows.map((x) => ({
    ...x,
    tier: tierForPriority(x.role_priority as number),
    roles: roles.get(x.id as number) || [],
    weekly_target: x.role_id != null ? targets.get(x.role_id as number) ?? null : null,
  }));
  return { members, target: null as number | null };
}

export async function loadProfileWeekly(userId: number): Promise<{
  weeklyEvents: number;
  weeklyTarget: number | null;
}> {
  await abandonStaleOpenGathers();
  const weeklyEvents = await syncWeeklyEventsForUser(query, userId, weekTimeZone());
  const weeklyTarget = await weeklyTargetForUser(userId);
  return { weeklyEvents, weeklyTarget };
}

export async function loadReprimandsMe(userId: number) {
  try {
    const r = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
              ib.nickname AS issued_by_nickname
       FROM reprimands rp
       LEFT JOIN users ib ON ib.id = rp.issued_by
       WHERE rp.user_id = $1
       ORDER BY rp.created_at DESC`,
      [userId]
    );
    return r.rows.map((row) => ({
      ...row,
      active: row.type === 'point'
        ? adminPointActive(row.created_at as string)
        : !(row.type === 'verbal' && row.converted),
      expires_at: row.type === 'point'
        ? new Date(new Date(row.created_at as string).getTime() + ADMIN_POINT_DECAY_DAYS * 864e5).toISOString()
        : null,
    }));
  } catch (error) {
    console.error('[cabinet] Не удалось загрузить выговоры профиля:', (error as Error).message);
    return [];
  }
}

function canSeeContentAudience(viewer: PublicUser | undefined, audience: string) {
  if (!viewer || audience === 'general') return true;
  if (audience === 'administrator') return !!(viewer.isOwner || viewer.isAdministrator);
  if (audience === 'helper') {
    return !!(viewer.isOwner || viewer.isEventHelper || viewer.isAdministrator);
  }
  return true;
}

export async function loadContent(section: string, viewer?: PublicUser) {
  const canSeeAuthor = !!viewer && (
    viewer.isOwner
    || viewer.isAdmin
    || viewer.isAdministrator
    || userHasPermission(roleCtxFromPublic(viewer), 'edit_content')
  );
  const r = await query<Record<string, unknown>>(
    `SELECT c.audience, c.body, c.image_id, c.updated_at, u.nickname AS updated_by_name
     FROM content_blocks c
     LEFT JOIN users u ON u.id = c.updated_by
     WHERE c.section = $1`,
    [section]
  );
  return Object.fromEntries(
    r.rows
      .filter((x) => canSeeContentAudience(viewer, String(x.audience)))
      .map((x) => [
      x.audience as string,
      {
        body: renderBody(x.body),
        bodyRaw: rawBodyForEdit(x.body),
        imageId: x.image_id as number | null,
        updatedAt: x.updated_at as string | null,
        updatedBy: canSeeAuthor ? (x.updated_by_name as string | null) : null,
      },
    ])
  );
}

export async function loadRules() {
  const r = await query<Record<string, unknown>>(
    `SELECT id, position, title, body, image_id, updated_at FROM rules ORDER BY position, id`
  );
  return r.rows.map((x) => ({
    ...x,
    bodyHtml: renderBody(x.body),
    bodyRaw: rawBodyForEdit(x.body),
  }));
}

export async function loadRoster() {
  const tz = weekTimeZone();
  const targets = await weeklyTargetsByRoleId();
  const weekCountSql = sqlCountWeeklyMpSubquery('u.discord_id', 1);
  const r = await query<Record<string, unknown>>(
    `SELECT u.id, u.nickname, u.discord_username, u.avatar_image_id, u.avatar_url,
            CASE WHEN u.discord_id IS NULL THEN 0 ELSE COALESCE(${weekCountSql}, 0) END AS weekly_events,
            u.note, u.status, u.is_blocked, u.blocked_at,
            u.is_owner, u.is_admin, u.role_id, r.name AS role_name, r.priority AS role_priority
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY COALESCE(r.priority, 999), u.nickname`,
    [tz],
  );
  const rolesMap = await getRolesForUsers(r.rows.map((x) => x.id as number));
  const allRoles = await query(
    `SELECT id, name, priority, COALESCE(permissions, '{}'::jsonb) AS permissions, weekly_events_target
     FROM roles ORDER BY priority`,
  );
  return {
    members: r.rows.map((x) => ({
      ...x,
      tier: tierForPriority(x.role_priority as number),
      roles: rolesMap.get(x.id as number) || [],
      weekly_target: x.role_id != null ? targets.get(x.role_id as number) ?? null : null,
    })),
    roles: allRoles.rows,
    target: null as number | null,
  };
}

export async function loadVacations(viewer?: PublicUser) {
  const r = await query<Record<string, unknown>>(
    `SELECT v.id, v.user_id, v.start_date, v.end_date, v.reason, v.status, v.created_at,
            u.nickname, u.avatar_url
     FROM vacations v
     JOIN users u ON u.id = v.user_id
     ORDER BY v.start_date`
  );
  const canReview = viewer && userHasPermission(roleCtxFromPublic(viewer), 'vacations_review');
  return r.rows.map((row) => ({
    ...row,
    reason: !viewer || viewer.isOwner || canReview || row.user_id === viewer.id ? row.reason : '',
  }));
}

export async function getApplicationsSettings() {
  try {
    await query(
      `INSERT INTO applications_settings (id, is_open) VALUES (1, TRUE)
       ON CONFLICT (id) DO NOTHING`,
    );
    const settings = await query<{ is_open: boolean; closed_message: string | null }>(
      'SELECT is_open, closed_message FROM applications_settings WHERE id=1',
    );
    return {
      isOpen: settings.rows[0]?.is_open ?? true,
      closedMessage: settings.rows[0]?.closed_message || DEFAULT_CLOSED_MESSAGE,
    };
  } catch {
    return { isOpen: true, closedMessage: DEFAULT_CLOSED_MESSAGE };
  }
}

export async function isApplicationsOpen(): Promise<boolean> {
  return (await getApplicationsSettings()).isOpen;
}

export async function loadApplications() {
  const settings = await getApplicationsSettings();
  const applications = await query<Record<string, unknown>>(
    `SELECT a.*, rb.nickname AS reviewed_by_nickname
     FROM applications a LEFT JOIN users rb ON rb.id = a.reviewed_by
     ORDER BY a.created_at DESC LIMIT 100`,
  );
  return {
    rows: applications.rows,
    isOpen: settings.isOpen,
    closedMessage: settings.closedMessage,
  };
}

export async function loadCandidates() {
  const r = await query<Record<string, unknown>>(
    `SELECT a.id, a.applicant_name, a.discord, a.nickname_static, a.status, a.created_at,
            a.candidate_user_id, cu.nickname AS candidate_nickname,
            cu.avatar_image_id AS candidate_avatar_image_id, cu.avatar_url AS candidate_avatar_url,
            rb.nickname AS reviewed_by_nickname
     FROM applications a
     LEFT JOIN users cu ON cu.id = a.candidate_user_id
     LEFT JOIN users rb ON rb.id = a.reviewed_by
     WHERE a.status='approved' ORDER BY a.created_at ASC`
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

