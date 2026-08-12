export const ADMIN_TIER_MAX_PRIORITY = 5;

export type Tier = 'admin' | 'helper';

export function tierForPriority(priority: number | null | undefined): Tier {
  if (priority == null) return 'helper';
  return priority <= ADMIN_TIER_MAX_PRIORITY ? 'admin' : 'helper';
}
