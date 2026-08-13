export const ACHIEVEMENT_TRIGGERS = [
  'weekly_top_1',
  'days_in_ranks',
  'reached_role',
] as const;

export type AchievementTrigger = (typeof ACHIEVEMENT_TRIGGERS)[number];

export const ACHIEVEMENT_TRIGGER_LABELS: Record<AchievementTrigger, string> = {
  weekly_top_1: 'ТОП 1 в статистике за неделю',
  days_in_ranks: 'Находиться в рядах N дней',
  reached_role: 'Достиг роли',
};
