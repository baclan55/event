export const ACHIEVEMENT_TRIGGERS = [
  'weekly_top_1',
  'days_in_ranks',
  'reached_role',
  'gmp_total',
  'gmp_period',
] as const;

export type AchievementTrigger = (typeof ACHIEVEMENT_TRIGGERS)[number];

export const ACHIEVEMENT_TRIGGER_LABELS: Record<AchievementTrigger, string> = {
  weekly_top_1: 'ТОП 1 в статистике за неделю',
  days_in_ranks: 'Находиться в рядах N дней',
  reached_role: 'Достиг роли',
  gmp_total: 'Участие в ГМП (всего)',
  gmp_period: 'Участие в ГМП за период',
};

export const GMP_PERIODS = ['week', 'month', 'year'] as const;
export type GmpPeriod = (typeof GMP_PERIODS)[number];

export const GMP_PERIOD_LABELS: Record<GmpPeriod, string> = {
  week: 'За неделю',
  month: 'За месяц',
  year: 'За год',
};
