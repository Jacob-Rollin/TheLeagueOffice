/** True when a user_roles.role value is Admin (case-insensitive). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role?.toLowerCase() === "admin";
}

export function hasAdminRole(roles: Array<{ role?: string | null } | string> | null | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((entry) => isAdminRole(typeof entry === "string" ? entry : entry.role));
}
