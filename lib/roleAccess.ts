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
  'candidates',
  'vacations_review',
  'edit_content',
  'manage_roles',
  'grant_owner',
  'view_audit',
  'manage_blacklist',
  'manage_achievements',
  'manage_gmp',
  'moderate_profile',
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
  manage_staff: 'Добавление помощников организаторов',
  edit_winners: 'Редактирование списка победителей',
  edit_body: 'Редактирование описания ГМП',
  edit_checkpoints: 'Редактирование таблицы точек',
  marks: 'Добавление/удаление отметок из таблицы точек',
  view_stats: 'Просмотр статистики мероприятия',
};

const GMP_WRITE_CAPS: readonly GmpCap[] = [
  'create',
  'manage_staff',
  'edit_winners',
  'edit_body',
  'edit_checkpoints',
  'marks',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  reprimands: 'Система выговоров',
  applications: 'Заявки на набор',
  candidates: 'Кандидаты / обзвон',
  vacations_review: 'Рассмотрение отпусков',
  edit_content: 'Контент и состав',
  manage_roles: 'Роли и доступы',
  grant_owner: 'Выдача права владельца',
  view_audit: 'Журнал действий',
  manage_blacklist: 'Чёрный список',
  manage_achievements: 'Достижения',
  manage_gmp: 'ГМП',
  moderate_profile: 'Модерация игровых данных',
};

/** У каких функций нет смысла в «редактировании» — только просмотр. */
export const VIEW_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set(['view_audit']);

export const PERMISSION_FALLBACK_ROLES: Record<Permission, readonly string[]> = {
  reprimands: REPRIMANDS_ROLES,
  applications: APPLICATIONS_ROLES,
  candidates: CANDIDATES_ROLES,
  vacations_review: VACATIONS_REVIEW_ROLES,
  edit_content: EDIT_ROLES,
  manage_roles: OWNER_PANEL_ROLES,
  grant_owner: [],
  view_audit: OWNER_PANEL_ROLES,
  manage_blacklist: OWNER_PANEL_ROLES,
  manage_achievements: OWNER_PANEL_ROLES,
  manage_gmp: EDIT_ROLES,
  moderate_profile: REPRIMANDS_ROLES,
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

export function normalizeRolePermissions(raw: unknown): Record<Permission, PermissionAccess> {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const key of PERMISSIONS) {
    if (key in source) {
      base[key] = key === 'manage_gmp'
        ? normalizeGmpAccess(source[key])
        : normalizePermissionAccess(source[key]);
      if (VIEW_ONLY_PERMISSIONS.has(key)) base[key].edit = false;
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
        : { view: true, edit: full };
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
}): RoleUser {
  return {
    is_owner: !!user.isOwner,
    roleNames: user.roles || [],
    permissions: user.permissions || [],
    editPermissions: user.editPermissions || [],
    gmpCaps: user.gmpCaps || [],
  };
}

export function gmpCapsFromRole(name: string, rawPermissions: unknown): GmpCap[] {
  const access = accessFromRole(name, rawPermissions);
  return gmpCapsFromAccess(normalizeGmpAccess(access.manage_gmp));
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
  return userHasRoleIn(user, PERMISSION_FALLBACK_ROLES[permission]);
}
