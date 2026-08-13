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

export const PERMISSION_LABELS: Record<Permission, string> = {
  reprimands: 'Система выговоров',
  applications: 'Заявки на набор',
  candidates: 'Кандидаты / обзвон',
  vacations_review: 'Рассмотрение отпусков',
  edit_content: 'Редактирование контента и состава',
  manage_roles: 'Управление ролями и доступами',
  grant_owner: 'Выдача права владельца',
  view_audit: 'Журнал действий',
  manage_blacklist: 'Чёрный список',
  manage_achievements: 'Достижения',
  moderate_profile: 'Модерация игровых данных',
};

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

export type RolePermissions = Partial<Record<Permission, boolean>>;

export type RoleUser = {
  role_id?: number | null;
  is_owner?: boolean;
  role_name?: string | null;
  roleNames?: string[];
  permissions?: Permission[];
};

export function emptyPermissions(): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((key) => [key, false])) as Record<Permission, boolean>;
}

export function normalizeRolePermissions(raw: unknown): Record<Permission, boolean> {
  const base = emptyPermissions();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  for (const key of PERMISSIONS) {
    if (typeof source[key] === 'boolean') base[key] = source[key];
  }
  return base;
}

export function permissionsFromRole(name: string, rawPermissions: unknown): Permission[] {
  const normalized = normalizeRolePermissions(rawPermissions);
  const hasExplicit = !!rawPermissions && typeof rawPermissions === 'object'
    && Object.keys(rawPermissions as object).length > 0;
  if (hasExplicit) {
    return PERMISSIONS.filter((key) => normalized[key]);
  }
  return PERMISSIONS.filter((key) => PERMISSION_FALLBACK_ROLES[key].includes(name));
}

export function defaultPermissionsForRoleName(name: string): Record<Permission, boolean> {
  const result = emptyPermissions();
  for (const key of PERMISSIONS) {
    result[key] = PERMISSION_FALLBACK_ROLES[key].includes(name);
  }
  return result;
}

export function userHasAnyRole(user: RoleUser | null | undefined): boolean {
  return !!(user && (user.role_id != null || user.is_owner));
}

export function userHasRoleIn(
  user: RoleUser | null | undefined,
  roles: readonly string[]
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.roleNames)) {
    return user.roleNames.some((name) => roles.includes(name));
  }
  return !!(user.role_name && roles.includes(user.role_name));
}

export function userHasPermission(
  user: RoleUser | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.is_owner) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes(permission)) {
    return true;
  }
  return userHasRoleIn(user, PERMISSION_FALLBACK_ROLES[permission]);
}
