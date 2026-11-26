// Who may do what (D-042) and the cross-site check on every POST outside /api/ (D-040).

export type Role = 'member' | 'org_admin' | 'global_admin';

export interface SignedInUser {
  id: number;
  displayName: string;
  role: Role;
  /** Null only for a global admin. */
  organizationId: number | null;
}

export type Permission = 'view' | 'maintenance' | 'write_update' | 'manage_monitors';

const MEMBER: Permission[] = ['view', 'maintenance', 'write_update'];
const ALLOWED: Record<Role, Permission[]> = {
  member: MEMBER,
  org_admin: [...MEMBER, 'manage_monitors'],
  global_admin: [...MEMBER, 'manage_monitors'],
};

export const can = (user: SignedInUser, permission: Permission) => ALLOWED[user.role].includes(permission);

/** The organization a user's reads and writes are limited to; null is every organization. */
export const scopeOf = (user: SignedInUser) => (user.role === 'global_admin' ? null : user.organizationId);

/** True when the browser says the form came from this site: the Origin's host is the request's Host. */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
