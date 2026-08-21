export const REPRIMANDS_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Senior Event Helper',
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
] as const;

export const APPLICATIONS_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
] as const;

export const CANDIDATES_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Senior Event Helper',
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
] as const;

/** @deprecated панель владельца удалена; список используется как fallback для manage_roles/view_audit */
export const OWNER_PANEL_ROLES = [
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
] as const;

export const VACATIONS_REVIEW_ROLES = [
  'Chief Event Helper',
  'Chief Event',
  'Dep.Chief Event',
] as const;

export const EDIT_ROLES = [
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
] as const;

export const PERMISSIONS = [
  'reprimands',
  'applications',
  'application_history',
  'candidates',
  'vacations_review',
  'edit_content',
  'manage_roles',
  'grant_owner',
  'view_audit',
  'manage_blacklist',
  'manage_achievements',
  'manage_props',
  'manage_gmp',
  'manage_events',
  'manage_payouts',
  'moderate_profile',
  'view_profile',
  'view_statistics',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionLevel = 'view' | 'edit';

export type PermissionAccess = {
  view: boolean;
  edit: boolean;
};

/** Гранулярные права внутри раздела ГМП (хранятся в permissions.manage_gmp). */
export const GMP_CAPS = [
  'create',
  'manage_staff',
  'edit_winners',
  'edit_body',
  'edit_checkpoints',
  'marks',
  'view_stats',
] as const;

export type GmpCap = (typeof GMP_CAPS)[number];

export type GmpPermissionAccess = PermissionAccess & Record<GmpCap, boolean>;

export const GMP_CAP_LABELS: Record<GmpCap, string> = {
  create: 'Создание',
  manage_staff: 'Состав (помощники)',
  edit_winners: 'Список победителей',
  edit_body: 'Описание ГМП',
  edit_checkpoints: 'Таблица точек',
  marks: 'Отметки в таблице',
  view_stats: 'Статистика',
};

const GMP_WRITE_CAPS: readonly GmpCap[] = [
  'create',
  'manage_staff',
  'edit_winners',
  'edit_body',
  'edit_checkpoints',
  'marks',
];

/** Гранулярные права внутри раздела «Мероприятия». */
export const EVENT_CAPS = [
  'edit_participants',
  'edit_status',
  'delete',
] as const;

export type EventCap = (typeof EVENT_CAPS)[number];

export type EventsPermissionAccess = PermissionAccess & Record<EventCap, boolean>;

export const EVENT_CAP_LABELS: Record<EventCap, string> = {
  edit_participants: 'Редактирование участников мероприятий',
  edit_status: 'Редактирование статуса мероприятия',
  delete: 'Удаление мероприятий',
};

/** Вкладки профиля (свой / чужой) — хранятся в permissions.view_profile. */
export const PROFILE_VIEW_CAPS = [
  'reprimands',
  'achievements',
  'events',
  'gmp',
  'audit',
] as const;

export type ProfileViewCap = (typeof PROFILE_VIEW_CAPS)[number];

export type ProfileTabCaps = Record<ProfileViewCap, boolean>;

export type ProfileViewAccess = PermissionAccess & ProfileTabCaps & {
  own: ProfileTabCaps;
  others: ProfileTabCaps;
};

export const PROFILE_VIEW_CAP_LABELS: Record<ProfileViewCap, string> = {
  reprimands: 'Выговоры',
  achievements: 'Достижения',
  events: 'Мероприятия (МП)',
  gmp: 'ГМП',
  audit: 'Журнал действий',
};

/** Страницы раздела «Статистика» (хранятся в permissions.view_statistics). */
export const STATS_CAPS = [
  'overview',
  'events',
  'users',
  'achievements',
  'gmp',
  'applications',
  'reprimands',
] as const;

export type StatsCap = (typeof STATS_CAPS)[number];

export type StatsPermissionAccess = PermissionAccess & Record<StatsCap, boolean>;

export const STATS_CAP_LABELS: Record<StatsCap, string> = {
  overview: 'Обзор',
  events: 'Проведение мероприятий',
  users: 'Пользователи',
  achievements: 'Достижения',
  gmp: 'ГМП',
  applications: 'Заявки и набор',
  reprimands: 'Выговоры',
};

export const STATS_CAP_PATHS: Record<StatsCap, string> = {
  overview: '/app/statistics',
  events: '/app/statistics/events',
  users: '/app/statistics/users',
  achievements: '/app/statistics/achievements',
  gmp: '/app/statistics/gmp',
  applications: '/app/statistics/applications',
  reprimands: '/app/statistics/reprimands',
};

export function emptyProfileTabCaps(): ProfileTabCaps {
  return {
    reprimands: false,
    achievements: false,
    events: false,
    gmp: false,
    audit: false,
  };
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  reprimands: 'Система выговоров',
  applications: 'Заявки на набор',
  application_history: 'История заявок',
  candidates: 'Кандидаты / обзвон',
  vacations_review: 'Рассмотрение отпусков',
  edit_content: 'Контент и состав',
  manage_roles: 'Роли и доступы',
  grant_owner: 'Выдача права владельца',
  view_audit: 'Журнал действий',
  manage_blacklist: 'Чёрный список',
  manage_achievements: 'Достижения',
  manage_props: 'Пропы',
  manage_gmp: 'ГМП',
  manage_events: 'Мероприятия',
  manage_payouts: 'Выплаты хелперам',
  moderate_profile: 'Модерация игровых данных',
  view_profile: 'Просмотр профиля',
  view_statistics: 'Статистика',
};

/** У каких функций нет смысла в «редактировании» — только просмотр. */
export const VIEW_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'view_audit',
  'view_profile',
  'application_history',
  'view_statistics',
]);

export const PERMISSION_FALLBACK_ROLES: Record<Permission, readonly string[]> = {
  reprimands: REPRIMANDS_ROLES,
  applications: APPLICATIONS_ROLES,
  application_history: APPLICATIONS_ROLES,
  candidates: CANDIDATES_ROLES,
  vacations_review: VACATIONS_REVIEW_ROLES,
  edit_content: EDIT_ROLES,
  manage_roles: OWNER_PANEL_ROLES,
  grant_owner: [],
  view_audit: OWNER_PANEL_ROLES,
  manage_blacklist: OWNER_PANEL_ROLES,
  manage_achievements: OWNER_PANEL_ROLES,
  manage_props: OWNER_PANEL_ROLES,
  manage_gmp: EDIT_ROLES,
  manage_events: EDIT_ROLES,
  manage_payouts: EDIT_ROLES,
  moderate_profile: REPRIMANDS_ROLES,
  view_profile: [],
  view_statistics: OWNER_PANEL_ROLES,
};

export type RolePermissions = Partial<Record<Permission, PermissionAccess | boolean>>;

export type RoleUser = {
  role_id?: number | null;
  is_owner?: boolean;
  role_name?: string | null;
  roleNames?: string[];
  permissions?: Permission[];
  editPermissions?: Permission[];
  gmpCaps?: GmpCap[];
  eventCaps?: EventCap[];
  profileViewCaps?: ProfileViewCap[];
  profileOwnViewCaps?: ProfileViewCap[];
  statsCaps?: StatsCap[];
};

export function emptyPermissionAccess(): PermissionAccess {
  return { view: false, edit: false };
}

export function emptyPermissions(): Record<Permission, PermissionAccess> {
  return Object.fromEntries(PERMISSIONS.map((key) => [key, emptyPermissionAccess()])) as Record<
    Permission,
    PermissionAccess
  >;
}

export function normalizePermissionAccess(raw: unknown): PermissionAccess {
  if (raw === true) return { view: true, edit: true };
  if (raw && typeof raw === 'object') {
    const source = raw as Record<string, unknown>;
    const edit = !!source.edit;
    const view = !!source.view || edit;
    return { view, edit };
  }
  return emptyPermissionAccess();
}

export function emptyGmpAccess(): GmpPermissionAccess {
  return {
    view: false,
    edit: false,
    create: false,
    manage_staff: false,
    edit_winners: false,
    edit_body: false,
    edit_checkpoints: false,
    marks: false,
    view_stats: false,
  };
}

export function normalizeGmpAccess(raw: unknown): GmpPermissionAccess {
  const base = normalizePermissionAccess(raw);
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hasExplicitCaps = GMP_CAPS.some((cap) => cap in source);
  const caps = emptyGmpAccess();
  caps.view = base.view;
  caps.edit = base.edit;

  if (hasExplicitCaps) {
    for (const cap of GMP_CAPS) caps[cap] = !!source[cap];
  } else if (base.edit) {
    for (const cap of GMP_CAPS) caps[cap] = true;
  } else if (base.view) {
    caps.view_stats = true;
  }

  const anyCap = GMP_CAPS.some((cap) => caps[cap]);
  const anyWrite = GMP_WRITE_CAPS.some((cap) => caps[cap]);
  caps.view = caps.view || anyCap;
  caps.edit = caps.edit || anyWrite;
  return caps;
}

export function gmpCapsFromAccess(access: GmpPermissionAccess): GmpCap[] {
  return GMP_CAPS.filter((cap) => access[cap]);
}

export function emptyEventsAccess(): EventsPermissionAccess {
  return {
    view: false,
    edit: false,
    edit_participants: false,
    edit_status: false,
    delete: false,
  };
}

export function normalizeEventsAccess(raw: unknown): EventsPermissionAccess {
  const base = normalizePermissionAccess(raw);
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hasExplicitCaps = EVENT_CAPS.some((cap) => cap in source);
  const caps = emptyEventsAccess();
  caps.view = base.view;
  caps.edit = base.edit;

  if (hasExplicitCaps) {
    for (const cap of EVENT_CAPS) caps[cap] = !!source[cap];
  } else if (base.edit) {
    for (const cap of EVENT_CAPS) caps[cap] = true;
  }

  const anyCap = EVENT_CAPS.some((cap) => caps[cap]);
  caps.view = caps.view || anyCap;
  caps.edit = caps.edit || anyCap;
  return caps;
}

export function eventCapsFromAccess(access: EventsPermissionAccess): EventCap[] {
  return EVENT_CAPS.filter((cap) => access[cap]);
}

export function emptyStatsAccess(): StatsPermissionAccess {
  return {
    view: false,
    edit: false,
    overview: false,
    events: false,
    users: false,
    achievements: false,
    gmp: false,
    applications: false,
    reprimands: false,
  };
}

export function normalizeStatsAccess(raw: unknown): StatsPermissionAccess {
  const base = normalizePermissionAccess(raw);
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hasExplicitCaps = STATS_CAPS.some((cap) => cap in source);
  const caps = emptyStatsAccess();
  caps.view = base.view;
  caps.edit = false;

  if (hasExplicitCaps) {
    for (const cap of STATS_CAPS) caps[cap] = !!source[cap];
  } else if (base.view || base.edit) {
    for (const cap of STATS_CAPS) caps[cap] = true;
  }

  const anyCap = STATS_CAPS.some((cap) => caps[cap]);
  caps.view = caps.view || anyCap;
  return caps;
}

export function statsCapsFromAccess(access: StatsPermissionAccess): StatsCap[] {
  return STATS_CAPS.filter((cap) => access[cap]);
}

export function emptyProfileViewAccess(): ProfileViewAccess {
  return {
    view: false,
    edit: false,
    ...emptyProfileTabCaps(),
    own: emptyProfileTabCaps(),
    others: emptyProfileTabCaps(),
  };
}

function applyLegacyOpenTabs(target: ProfileTabCaps, includeAudit = false) {
  for (const key of PROFILE_VIEW_CAPS) {
    if (includeAudit || key !== 'audit') target[key] = true;
  }
}

/**
 * Просмотр вкладок своего и чужого профиля.
 * Legacy без own/others: чужие — как раньше по плоским флагам; свой — все вкладки кроме журнала.
 */
export function normalizeProfileViewAccess(raw: unknown, opts?: { legacyOpen?: boolean }): ProfileViewAccess {
  const caps = emptyProfileViewAccess();
  if (!raw || typeof raw !== 'object') {
    if (opts?.legacyOpen) {
      caps.view = true;
      applyLegacyOpenTabs(caps.others);
      applyLegacyOpenTabs(caps.own);
      for (const key of PROFILE_VIEW_CAPS) caps[key] = caps.others[key];
    }
    return caps;
  }
  const source = raw as Record<string, unknown>;
  const base = normalizePermissionAccess(raw);
  caps.view = base.view || base.edit;
  caps.edit = false;

  const hasOthers = source.others != null && typeof source.others === 'object';
  const hasOwn = source.own != null && typeof source.own === 'object';

  if (hasOthers) {
    const others = source.others as Record<string, unknown>;
    for (const cap of PROFILE_VIEW_CAPS) caps.others[cap] = !!others[cap];
  } else {
    const hasExplicitCaps = PROFILE_VIEW_CAPS.some((cap) => cap in source);
    if (hasExplicitCaps) {
      for (const cap of PROFILE_VIEW_CAPS) caps.others[cap] = !!source[cap];
    } else if (caps.view) {
      applyLegacyOpenTabs(caps.others);
    }
  }

  if (hasOwn) {
    const own = source.own as Record<string, unknown>;
    for (const cap of PROFILE_VIEW_CAPS) caps.own[cap] = !!own[cap];
  } else {
    // До явной настройки «Свой профиль» — вкладки открыты (журнал по-прежнему отдельно).
    applyLegacyOpenTabs(caps.own);
  }

  for (const cap of PROFILE_VIEW_CAPS) caps[cap] = caps.others[cap];
  const anyOther = PROFILE_VIEW_CAPS.some((cap) => caps.others[cap]);
  caps.view = caps.view || anyOther;
  return caps;
}

export function profileViewCapsFromAccess(access: ProfileViewAccess): ProfileViewCap[] {
  return PROFILE_VIEW_CAPS.filter((cap) => access.others[cap]);
}

export function profileOwnViewCapsFromAccess(access: ProfileViewAccess): ProfileViewCap[] {
  return PROFILE_VIEW_CAPS.filter((cap) => access.own[cap]);
}

export function normalizeRolePermissions(raw: unknown): Record<Permission, PermissionAccess> {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const key of PERMISSIONS) {
    if (key in source) {
      base[key] = key === 'manage_gmp'
        ? normalizeGmpAccess(source[key])
        : key === 'manage_events'
          ? normalizeEventsAccess(source[key])
          : key === 'view_profile'
            ? normalizeProfileViewAccess(source[key])
            : key === 'view_statistics'
              ? normalizeStatsAccess(source[key])
              : normalizePermissionAccess(source[key]);
      if (VIEW_ONLY_PERMISSIONS.has(key)) base[key].edit = false;
    } else if (key === 'manage_events') {
      // Раньше раздел был открыт всем с ролью — сохраняем просмотр до явной настройки.
      base[key] = normalizeEventsAccess({ view: true });
    } else if (key === 'view_profile') {
      // До явной настройки — открытый просмотр вкладок (как раньше).
      base[key] = normalizeProfileViewAccess(null, { legacyOpen: true });
    }
  }
  return base;
}

function accessFromRole(name: string, rawPermissions: unknown): Record<Permission, PermissionAccess> {
  const hasExplicit = !!rawPermissions && typeof rawPermissions === 'object'
    && Object.keys(rawPermissions as object).length > 0;
  if (hasExplicit) return normalizeRolePermissions(rawPermissions);
  const result = emptyPermissions();
  for (const key of PERMISSIONS) {
    if (PERMISSION_FALLBACK_ROLES[key].includes(name)) {
      const full = !VIEW_ONLY_PERMISSIONS.has(key);
      result[key] = key === 'manage_gmp'
        ? normalizeGmpAccess({ view: true, edit: full })
        : key === 'manage_events'
          ? normalizeEventsAccess({ view: true, edit: full })
          : key === 'view_profile'
            ? normalizeProfileViewAccess(null, { legacyOpen: true })
            : key === 'view_statistics'
              ? normalizeStatsAccess({ view: true })
              : { view: true, edit: full };
    } else if (key === 'manage_events') {
      result[key] = normalizeEventsAccess({ view: true });
    } else if (key === 'view_profile') {
      result[key] = normalizeProfileViewAccess(null, { legacyOpen: true });
    }
  }
  return result;
}

export function permissionsFromRole(name: string, rawPermissions: unknown): Permission[] {
  const access = accessFromRole(name, rawPermissions);
  return PERMISSIONS.filter((key) => access[key].view || access[key].edit);
}

export function editPermissionsFromRole(name: string, rawPermissions: unknown): Permission[] {
  const access = accessFromRole(name, rawPermissions);
  return PERMISSIONS.filter((key) => access[key].edit);
}

export function defaultPermissionsForRoleName(name: string): Record<Permission, PermissionAccess> {
  return accessFromRole(name, null);
}

export function userHasAnyRole(user: RoleUser | null | undefined): boolean {
  return !!(user && (user.role_id != null || user.is_owner));
}

export function userHasRoleIn(
  user: RoleUser | null | undefined,
  roles: readonly string[],
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.roleNames)) {
    return user.roleNames.some((name) => roles.includes(name));
  }
  return !!(user.role_name && roles.includes(user.role_name));
}

/** Контекст прав из PublicUser / сессии для userHasPermission. */
export function roleCtxFromPublic(user: {
  isOwner?: boolean;
  roles?: string[];
  permissions?: Permission[];
  editPermissions?: Permission[];
  gmpCaps?: GmpCap[];
  eventCaps?: EventCap[];
  profileViewCaps?: ProfileViewCap[];
  profileOwnViewCaps?: ProfileViewCap[];
  statsCaps?: StatsCap[];
}): RoleUser {
  return {
    is_owner: !!user.isOwner,
    roleNames: user.roles || [],
    permissions: user.permissions || [],
    editPermissions: user.editPermissions || [],
    gmpCaps: user.gmpCaps || [],
    eventCaps: user.eventCaps || [],
    profileViewCaps: user.profileViewCaps || [],
    profileOwnViewCaps: user.profileOwnViewCaps || [],
    statsCaps: user.statsCaps || [],
  };
}

export function gmpCapsFromRole(name: string, rawPermissions: unknown): GmpCap[] {
  const access = accessFromRole(name, rawPermissions);
  return gmpCapsFromAccess(normalizeGmpAccess(access.manage_gmp));
}

export function eventCapsFromRole(name: string, rawPermissions: unknown): EventCap[] {
  const access = accessFromRole(name, rawPermissions);
  return eventCapsFromAccess(normalizeEventsAccess(access.manage_events));
}

export function statsCapsFromRole(name: string, rawPermissions: unknown): StatsCap[] {
  const access = accessFromRole(name, rawPermissions);
  return statsCapsFromAccess(normalizeStatsAccess(access.view_statistics));
}

export function profileViewCapsFromRole(name: string, rawPermissions: unknown): ProfileViewCap[] {
  const hasExplicit = !!rawPermissions && typeof rawPermissions === 'object'
    && 'view_profile' in (rawPermissions as object);
  if (hasExplicit) {
    const raw = (rawPermissions as Record<string, unknown>).view_profile;
    return profileViewCapsFromAccess(normalizeProfileViewAccess(raw));
  }
  // Legacy: МП/ГМП/достижения открыты; выговоры и журнал — по старым правам разделов.
  const access = accessFromRole(name, rawPermissions);
  const caps: ProfileViewCap[] = ['achievements', 'events', 'gmp'];
  if (access.reprimands.view || access.reprimands.edit) caps.push('reprimands');
  if (access.view_audit.view) caps.push('audit');
  return caps;
}

export function profileOwnViewCapsFromRole(name: string, rawPermissions: unknown): ProfileViewCap[] {
  const hasExplicit = !!rawPermissions && typeof rawPermissions === 'object'
    && 'view_profile' in (rawPermissions as object);
  if (hasExplicit) {
    const raw = (rawPermissions as Record<string, unknown>).view_profile;
    const normalized = normalizeProfileViewAccess(raw);
    const caps = profileOwnViewCapsFromAccess(normalized);
    const hasOwnBlock = !!raw && typeof raw === 'object' && 'own' in (raw as object);
    if (!hasOwnBlock) {
      // До секции «Свой профиль» журнал в своём шёл через view_audit.
      const access = accessFromRole(name, rawPermissions);
      if ((access.view_audit.view || access.view_audit.edit) && !caps.includes('audit')) {
        caps.push('audit');
      }
    }
    return caps;
  }
  const caps: ProfileViewCap[] = PROFILE_VIEW_CAPS.filter((cap) => cap !== 'audit');
  const access = accessFromRole(name, rawPermissions);
  if (access.view_audit.view || access.view_audit.edit) caps.push('audit');
  return caps;
}

export function userHasProfileViewCap(
  user: RoleUser | null | undefined,
  cap: ProfileViewCap,
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.profileViewCaps) && user.profileViewCaps.includes(cap)) return true;
  if (!Array.isArray(user.profileViewCaps)) {
    if (cap === 'audit') return userHasPermission(user, 'view_audit');
    if (cap === 'reprimands') return userHasPermission(user, 'reprimands');
    return true;
  }
  return false;
}

export function userHasProfileOwnViewCap(
  user: RoleUser | null | undefined,
  cap: ProfileViewCap,
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.profileOwnViewCaps)) {
    return user.profileOwnViewCaps.includes(cap);
  }
  // Старые сессии без profileOwnViewCaps: как раньше — всё, журнал по view_audit.
  if (cap === 'audit') return userHasPermission(user, 'view_audit');
  return true;
}

export function userHasGmpCap(
  user: RoleUser | null | undefined,
  cap: GmpCap,
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.gmpCaps) && user.gmpCaps.includes(cap)) return true;
  // Fallback: полный edit manage_gmp → все caps (старые сессии без gmpCaps).
  if (
    (!Array.isArray(user.gmpCaps) || user.gmpCaps.length === 0)
    && userHasPermission(user, 'manage_gmp', 'edit')
  ) {
    return true;
  }
  // view-only legacy: только статистика
  if (
    cap === 'view_stats'
    && (!Array.isArray(user.gmpCaps) || user.gmpCaps.length === 0)
    && userHasPermission(user, 'manage_gmp', 'view')
  ) {
    return true;
  }
  return false;
}

export function userHasEventCap(
  user: RoleUser | null | undefined,
  cap: EventCap,
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.eventCaps) && user.eventCaps.includes(cap)) return true;
  if (
    (!Array.isArray(user.eventCaps) || user.eventCaps.length === 0)
    && userHasPermission(user, 'manage_events', 'edit')
  ) {
    return true;
  }
  return false;
}

export function userHasStatsCap(
  user: RoleUser | null | undefined,
  cap: StatsCap,
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.statsCaps) && user.statsCaps.includes(cap)) return true;
  if (
    (!Array.isArray(user.statsCaps) || user.statsCaps.length === 0)
    && userHasPermission(user, 'view_statistics', 'view')
  ) {
    return true;
  }
  return false;
}

export function userHasPermission(
  user: RoleUser | null | undefined,
  permission: Permission,
  level: PermissionLevel = 'view',
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (level === 'edit') {
    if (Array.isArray(user.editPermissions) && user.editPermissions.includes(permission)) {
      return true;
    }
    // Старые сессии без editPermissions: полный доступ по permissions.
    if (!Array.isArray(user.editPermissions) && Array.isArray(user.permissions)
      && user.permissions.includes(permission)) {
      return true;
    }
    return userHasRoleIn(user, PERMISSION_FALLBACK_ROLES[permission])
      && !VIEW_ONLY_PERMISSIONS.has(permission);
  }
  if (Array.isArray(user.permissions) && user.permissions.includes(permission)) {
    return true;
  }
  // Любой GMP-cap даёт просмотр раздела.
  if (
    permission === 'manage_gmp'
    && Array.isArray(user.gmpCaps)
    && user.gmpCaps.length > 0
  ) {
    return true;
  }
  if (
    permission === 'manage_events'
    && Array.isArray(user.eventCaps)
    && user.eventCaps.length > 0
  ) {
    return true;
  }
  if (
    permission === 'view_statistics'
    && Array.isArray(user.statsCaps)
    && user.statsCaps.length > 0
  ) {
    return true;
  }
  return userHasRoleIn(user, PERMISSION_FALLBACK_ROLES[permission]);
}
