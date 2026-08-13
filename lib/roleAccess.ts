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
  'moderate_profile',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionLevel = 'view' | 'edit';

export type PermissionAccess = {
  view: boolean;
  edit: boolean;
};

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

export function normalizeRolePermissions(raw: unknown): Record<Permission, PermissionAccess> {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const key of PERMISSIONS) {
    if (key in source) {
      base[key] = normalizePermissionAccess(source[key]);
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
      result[key] = VIEW_ONLY_PERMISSIONS.has(key)
        ? { view: true, edit: false }
        : { view: true, edit: true };
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
}): RoleUser {
  return {
    is_owner: !!user.isOwner,
    roleNames: user.roles || [],
    permissions: user.permissions || [],
    editPermissions: user.editPermissions || [],
  };
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
  return userHasRoleIn(user, PERMISSION_FALLBACK_ROLES[permission]);
}
