import { query } from '@/lib/db';
import type { AchievementTrigger } from '@/lib/achievementsShared';

export {
  ACHIEVEMENT_TRIGGERS,
  ACHIEVEMENT_TRIGGER_LABELS,
  type AchievementTrigger,
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
  return `Для следующей степени: ${grade + 1} / ${item.max_grade}`;
}

/** Каталог достижений для профиля: полученные / неполученные / скрытые. */
export async function listProfileAchievementCatalog(userId: number): Promise<{
  earned: ProfileAchievementCard[];
  locked: ProfileAchievementCard[];
  hidden: ProfileAchievementCard[];
}> {
  const [all, earnedRows] = await Promise.all([
    listAchievements(true),
    listUserAchievements(userId),
  ]);
  const byId = new Map(
    earnedRows.map((row) => [Number(row.achievement_id), row] as const),
  );

  const earned: ProfileAchievementCard[] = [];
  const locked: ProfileAchievementCard[] = [];
  const hidden: ProfileAchievementCard[] = [];

  for (const item of all) {
    const got = byId.get(item.id);
    const grade = got ? Math.max(1, Number(got.grade) || 1) : 0;
    const icons = item.grade_icons;
    const icon = grade > 0
      ? (icons[grade - 1] || item.icon || icons[0] || '')
      : (icons[0] || item.icon || '');
    const base = {
      id: item.id,
      name: item.name,
      icon,
      max_grade: item.max_grade,
      grade,
      awarded_at: got ? String(got.awarded_at) : null,
      is_hidden: !!item.is_hidden,
      next_hint: '',
    };

    if (got) {
      earned.push({
        ...base,
        description: String(item.description || ''),
        status: 'earned',
        next_hint: nextGradeHint(item, grade),
      });
      continue;
    }

    const lockedCard: ProfileAchievementCard = {
      ...base,
      description: '',
      status: item.is_hidden ? 'hidden' : 'locked',
      next_hint: '',
    };
    if (item.is_hidden) hidden.push(lockedCard);
    else locked.push(lockedCard);
  }

  earned.sort((a, b) => String(b.awarded_at || '').localeCompare(String(a.awarded_at || '')));
  locked.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  hidden.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { earned, locked, hidden };
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
  }
}
