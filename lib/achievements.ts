import { query } from '@/lib/db';
import { runtimeEnv } from '@/lib/runtimeEnv';
import type { AchievementTrigger, GmpPeriod } from '@/lib/achievementsShared';
import { GMP_PERIODS } from '@/lib/achievementsShared';

export {
  ACHIEVEMENT_TRIGGERS,
  ACHIEVEMENT_TRIGGER_LABELS,
  GMP_PERIODS,
  GMP_PERIOD_LABELS,
  type AchievementTrigger,
  type GmpPeriod,
} from '@/lib/achievementsShared';

export type AchievementRow = {
  id: number;
  name: string;
  description: string;
  icon: string;
  grade_icons: string[];
  trigger_type: AchievementTrigger;
  trigger_config: Record<string, unknown>;
  max_grade: number;
  active: boolean;
  is_hidden: boolean;
};

export type ProfileAchievementStatus = 'earned' | 'locked' | 'hidden';

export type ProfileAchievementCard = {
  id: number;
  name: string;
  /** Пусто, если достижение ещё не получено. */
  description: string;
  icon: string;
  max_grade: number;
  grade: number;
  awarded_at: string | null;
  status: ProfileAchievementStatus;
  is_hidden: boolean;
  next_hint: string;
};

function normalizeGradeIcons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim());
}

export async function listAchievements(activeOnly = false) {
  try {
    const result = await query<AchievementRow>(
      `SELECT id, name, description, icon,
              COALESCE(grade_icons, '[]'::jsonb) AS grade_icons,
              trigger_type, trigger_config, max_grade, active,
              COALESCE(is_hidden, FALSE) AS is_hidden
       FROM achievements
       ${activeOnly ? 'WHERE active = TRUE' : ''}
       ORDER BY id ASC`,
    );
    return result.rows.map((row) => ({
      ...row,
      grade_icons: normalizeGradeIcons(row.grade_icons),
      is_hidden: !!row.is_hidden,
    }));
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return [];
    throw error;
  }
}

function nextGradeHint(item: AchievementRow, grade: number): string {
  if (grade <= 0) return '';
  if (grade >= item.max_grade) return 'Максимальная степень';
  const cfg = item.trigger_config || {};
  if (item.trigger_type === 'days_in_ranks') {
    const thresholds = Array.isArray(cfg.grades)
      ? (cfg.grades as number[])
      : [Number(cfg.days) || 30];
    const next = thresholds[grade];
    if (next != null) return `Для следующей степени: ${next} дн. в рядах`;
  }
  if (item.trigger_type === 'reached_role') {
    return 'Для следующей степени: достигните следующей роли';
  }
  if (item.trigger_type === 'gmp_total' || item.trigger_type === 'gmp_period') {
    const thresholds = Array.isArray(cfg.grades)
      ? (cfg.grades as number[])
      : [Number(cfg.count) || 1];
    const next = thresholds[grade];
    if (next != null) {
      const period = item.trigger_type === 'gmp_period' ? String(cfg.period || 'week') : '';
      const periodLabel = period === 'month' ? 'за месяц' : period === 'year' ? 'за год' : period === 'week' ? 'за неделю' : '';
      return `Для следующей степени: ${next} ГМП${periodLabel ? ` ${periodLabel}` : ''}`;
    }
  }
  return `Для следующей степени: ${grade + 1} / ${item.max_grade}`;
}

function gradeFromThresholds(count: number, cfg: Record<string, unknown>, maxGrade: number) {
  const thresholds = Array.isArray(cfg.grades)
    ? (cfg.grades as number[])
    : [Number(cfg.count) || 1];
  let grade = 0;
  for (let i = 0; i < thresholds.length && i < maxGrade; i++) {
    if (count >= Number(thresholds[i])) grade = i + 1;
  }
  return grade;
}

async function countUserGmp(userId: number, period?: GmpPeriod | null) {
  const tz = runtimeEnv('WEEKLY_RESET_TZ') || 'Europe/Moscow';
  if (!period) {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM gmp_staff s
       JOIN gmp_events e ON e.id = s.event_id
       WHERE s.user_id = $1`,
      [userId],
    );
    return Number(result.rows[0]?.count || 0);
  }
  const trunc = period === 'month' ? 'month' : period === 'year' ? 'year' : 'week';
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM gmp_staff s
     JOIN gmp_events e ON e.id = s.event_id
     WHERE s.user_id = $1
       AND (e.starts_at AT TIME ZONE $2) >= date_trunc($3, now() AT TIME ZONE $2)`,
    [userId, tz, trunc],
  );
  return Number(result.rows[0]?.count || 0);
}

/**
 * Каталог достижений для профиля.
 * Описание: у обычных — всегда; у скрытых — только если его получил сам зритель
 * (в т.ч. при просмотре чужого профиля).
 */
export async function listProfileAchievementCatalog(
  profileUserId: number,
  viewerUserId: number = profileUserId,
): Promise<{
  earned: ProfileAchievementCard[];
  locked: ProfileAchievementCard[];
}> {
  const needViewerEarned = viewerUserId !== profileUserId;
  const [all, earnedRows, viewerEarnedRows] = await Promise.all([
    listAchievements(true),
    listUserAchievements(profileUserId),
    needViewerEarned ? listUserAchievements(viewerUserId) : Promise.resolve(null),
  ]);
  const byId = new Map(
    earnedRows.map((row) => [Number(row.achievement_id), row] as const),
  );
  const viewerHas = new Set(
    (viewerEarnedRows || earnedRows).map((row) => Number(row.achievement_id)),
  );

  const earned: ProfileAchievementCard[] = [];
  const locked: ProfileAchievementCard[] = [];

  for (const item of all) {
    const got = byId.get(item.id);
    const grade = got ? Math.max(1, Number(got.grade) || 1) : 0;
    const icons = item.grade_icons;
    const icon = grade > 0
      ? (icons[grade - 1] || item.icon || icons[0] || '')
      : (icons[0] || item.icon || '');
    const isHidden = !!item.is_hidden;
    const canSeeDescription = !isHidden || viewerHas.has(item.id);
    const description = canSeeDescription ? String(item.description || '') : '';
    const base = {
      id: item.id,
      name: item.name,
      icon,
      max_grade: item.max_grade,
      grade,
      awarded_at: got ? String(got.awarded_at) : null,
      is_hidden: isHidden,
      next_hint: '',
      description,
    };

    if (got) {
      earned.push({
        ...base,
        status: 'earned',
        next_hint: nextGradeHint(item, grade),
      });
      continue;
    }

    locked.push({
      ...base,
      status: isHidden ? 'hidden' : 'locked',
      next_hint: '',
    });
  }

  // Полученные: скрытые сверху, затем по дате.
  earned.sort((a, b) => {
    if (a.is_hidden !== b.is_hidden) return a.is_hidden ? -1 : 1;
    return String(b.awarded_at || '').localeCompare(String(a.awarded_at || ''));
  });
  // Не полученные: обычные сверху, скрытые в самом низу.
  locked.sort((a, b) => {
    if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1;
    return a.name.localeCompare(b.name, 'ru');
  });
  return { earned, locked };
}

export type UserAchievementRow = {
  achievement_id: number;
  grade: number;
  awarded_at: string;
  name: string;
  description: string;
  icon: string;
  grade_icons: string[];
  max_grade: number;
  trigger_type: AchievementTrigger;
};

export async function listUserAchievements(userId: number): Promise<UserAchievementRow[]> {
  try {
    const result = await query<UserAchievementRow>(
      `SELECT ua.achievement_id, ua.grade, ua.awarded_at,
              a.name, a.description, a.icon,
              COALESCE(a.grade_icons, '[]'::jsonb) AS grade_icons,
              a.max_grade, a.trigger_type
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.awarded_at DESC`,
      [userId],
    );
    return result.rows.map((row) => {
      const icons = normalizeGradeIcons(row.grade_icons);
      const grade = Math.max(1, Number(row.grade) || 1);
      const icon = icons[grade - 1] || String(row.icon || '') || icons[0] || '';
      return { ...row, grade_icons: icons, icon, grade };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return [];
    throw error;
  }
}

async function award(userId: number, achievementId: number, grade: number) {
  await query(
    `INSERT INTO user_achievements(user_id, achievement_id, grade)
     VALUES($1,$2,$3)
     ON CONFLICT (user_id, achievement_id) DO UPDATE
     SET grade = GREATEST(user_achievements.grade, EXCLUDED.grade),
         awarded_at = CASE
           WHEN EXCLUDED.grade > user_achievements.grade THEN now()
           ELSE user_achievements.awarded_at
         END`,
    [userId, achievementId, grade],
  );
}

/** Ленивая проверка триггеров для пользователя. */
export async function evaluateAchievementsForUser(userId: number): Promise<void> {
  const achievements = await listAchievements(true);
  if (!achievements.length) return;

  const user = await query<{
    created_at: string;
    role_id: number | null;
    weekly_events: number;
    role_priority: number | null;
    ranks_since: string | null;
  }>(
    `SELECT u.created_at, u.role_id, u.weekly_events, r.priority AS role_priority,
            (SELECT MIN(ur.assigned_at) FROM user_roles ur WHERE ur.user_id = u.id) AS ranks_since
     FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id=$1`,
    [userId],
  );
  if (!user.rows[0]) return;
  const u = user.rows[0];
  // «В рядах» = с первой выдачи роли (assigned_at), иначе дата создания аккаунта.
  const ranksFrom = u.ranks_since || u.created_at;
  const daysInRanks = Math.floor((Date.now() - new Date(ranksFrom).getTime()) / 864e5);

  for (const item of achievements) {
    const cfg = item.trigger_config || {};
    if (item.trigger_type === 'days_in_ranks') {
      if (!u.role_id && !u.ranks_since) continue;
      const thresholds = Array.isArray(cfg.grades)
        ? (cfg.grades as number[])
        : [Number(cfg.days) || 30];
      let grade = 0;
      for (let i = 0; i < thresholds.length && i < item.max_grade; i++) {
        if (daysInRanks >= Number(thresholds[i])) grade = i + 1;
      }
      if (grade > 0) await award(userId, item.id, grade);
    }
    if (item.trigger_type === 'reached_role') {
      const roleIds = Array.isArray(cfg.roleIds)
        ? (cfg.roleIds as number[]).map(Number)
        : [Number(cfg.roleId)].filter((id) => Number.isFinite(id) && id > 0);
      let grade = 0;
      for (let i = 0; i < roleIds.length && i < item.max_grade; i++) {
        const has = await query(
          'SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2 LIMIT 1',
          [userId, roleIds[i]],
        );
        if (has.rows[0] || u.role_id === roleIds[i]) grade = i + 1;
      }
      if (grade > 0) await award(userId, item.id, grade);
    }
    if (item.trigger_type === 'weekly_top_1') {
      const tier = String(cfg.tier || 'helper');
      const top = await query<{ id: number }>(
        tier === 'admin'
          ? `SELECT u.id FROM users u
             WHERE u.weekly_events > 0
               AND EXISTS (
                 SELECT 1 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND COALESCE(r.is_administrator, FALSE) = TRUE
               )
             ORDER BY u.weekly_events DESC, u.id ASC LIMIT 1`
          : `SELECT u.id FROM users u
             WHERE u.weekly_events > 0
               AND EXISTS (
                 SELECT 1 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND COALESCE(r.is_event_helper, FALSE) = TRUE
               )
             ORDER BY u.weekly_events DESC, u.id ASC LIMIT 1`,
      );
      if (top.rows[0]?.id === userId) await award(userId, item.id, 1);
    }
    if (item.trigger_type === 'gmp_total') {
      const count = await countUserGmp(userId);
      const grade = gradeFromThresholds(count, cfg, item.max_grade);
      if (grade > 0) await award(userId, item.id, grade);
    }
    if (item.trigger_type === 'gmp_period') {
      const periodRaw = String(cfg.period || 'week');
      const period = (GMP_PERIODS as readonly string[]).includes(periodRaw)
        ? (periodRaw as GmpPeriod)
        : 'week';
      const count = await countUserGmp(userId, period);
      const grade = gradeFromThresholds(count, cfg, item.max_grade);
      if (grade > 0) await award(userId, item.id, grade);
    }
  }
}
