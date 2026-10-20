import type { ApiRole } from '@mentor/api-contracts';
import type { MeResponse } from '@mentor/api-contracts';

/**
 * Account view model (T029).
 *
 * Pure functions only: what a screen may show about the signed-in account, and
 * what it must not. Roles come from the server and are displayed, never used to
 * grant anything on the client — a client that decided permissions would be a
 * client anyone can edit (`specs/07-permission-spec.md`, `AGENTS.md` §7).
 */

const ROLE_LABELS: Record<ApiRole, string> = {
  USER: '用户',
  PARENT: '家长',
  STUDENT: '学生',
  PROVIDER: '导师',
  ADMIN: '管理员',
  OPS: '运营',
  FINANCE: '财务',
  MODERATOR: '审核',
};

export interface AccountView {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** `SUSPENDED` is shown, not hidden: a banned account must see why. */
  suspended: boolean;
  statusText: string;
  roles: ApiRole[];
  roleText: string;
}

export function roleLabel(role: ApiRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function hasRole(user: { roles: ApiRole[] }, role: ApiRole): boolean {
  return user.roles.includes(role);
}

export function isSuspended(user: { status: MeResponse['status'] }): boolean {
  return user.status === 'SUSPENDED';
}

/** The account as a screen may render it. */
export function describeAccount(user: MeResponse): AccountView {
  return {
    id: user.id,
    name: user.displayName,
    avatarUrl: user.avatarUrl,
    suspended: isSuspended(user),
    statusText: isSuspended(user) ? '账号已被停用，请联系客服' : '正常',
    roles: [...user.roles],
    roleText: user.roles.length > 0 ? user.roles.map(roleLabel).join(' · ') : '未分配角色',
  };
}

/**
 * Can this account act as a guardian?
 *
 * Shown as a hint only: the server is the one that refuses when it must
 * (`specs/07`). The client never hides a route because of a role it guessed.
 */
export function looksLikeGuardian(user: MeResponse): boolean {
  return !isSuspended(user) && (hasRole(user, 'PARENT') || hasRole(user, 'USER'));
}
