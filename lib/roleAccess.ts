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

export type RoleUser = {
  role_id?: number | null;
  is_owner?: boolean;
  role_name?: string | null;
  roleNames?: string[];
};

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
