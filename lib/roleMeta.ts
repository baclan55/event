/** Классификация ролей и блоки дашборда (не функциональные permissions). */

export const DASHBOARD_BLOCKS = ['stats', 'top_admin', 'top_helper'] as const;
export type DashboardBlock = (typeof DASHBOARD_BLOCKS)[number];

export const DASHBOARD_BLOCK_LABELS: Record<DashboardBlock, string> = {
  stats: 'Сводка по составу',
  top_admin: 'Топ администраторов за неделю',
  top_helper: 'Топ хелперов за неделю',
};

export type RoleMeta = {
  isEventHelper: boolean;
  isAdministrator: boolean;
  includeInHelperPayouts: boolean;
  color: string;
  dashboardBlocks: Record<DashboardBlock, boolean>;
};

export function defaultDashboardBlocks(): Record<DashboardBlock, boolean> {
  return { stats: true, top_admin: true, top_helper: true };
}

export function normalizeDashboardBlocks(raw: unknown): Record<DashboardBlock, boolean> {
  const base = defaultDashboardBlocks();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const key of DASHBOARD_BLOCKS) {
    if (typeof source[key] === 'boolean') base[key] = source[key];
  }
  return base;
}

/** Нормализация цвета роли: #RGB / #RRGGBB или пусто. */
export function normalizeRoleColor(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return '';
}

export function defaultRoleMetaForName(name: string): RoleMeta {
  const adminNames = [
    'Chief Event',
    'Dep.Chief Event',
    'Technical Administrator',
    'Curator Event',
    'Event Administrator',
  ];
  const helperNames = [
    'Chief Event Helper',
    'Dep.Chief Event Helper',
    'Senior Event Helper',
    'Event Helper',
    'Mini Event Helper',
  ];
  const isHelper = helperNames.includes(name);
  return {
    isEventHelper: isHelper,
    isAdministrator: adminNames.includes(name),
    includeInHelperPayouts: isHelper,
    color: '',
    dashboardBlocks: defaultDashboardBlocks(),
  };
}

export function parseRoleMeta(row: {
  name?: string;
  is_event_helper?: boolean | null;
  is_administrator?: boolean | null;
  include_in_helper_payouts?: boolean | null;
  color?: string | null;
  dashboard_blocks?: unknown;
}): RoleMeta {
  const fallback = defaultRoleMetaForName(row.name || '');
  const hasExplicit =
    row.is_event_helper != null
    || row.is_administrator != null
    || row.include_in_helper_payouts != null
    || (row.color != null && String(row.color).length > 0)
    || (row.dashboard_blocks != null && typeof row.dashboard_blocks === 'object');
  if (!hasExplicit) return fallback;
  return {
    isEventHelper: !!row.is_event_helper,
    isAdministrator: !!row.is_administrator,
    includeInHelperPayouts:
      row.include_in_helper_payouts != null
        ? !!row.include_in_helper_payouts
        : !!row.is_event_helper,
    color: normalizeRoleColor(row.color),
    dashboardBlocks: normalizeDashboardBlocks(row.dashboard_blocks),
  };
}
