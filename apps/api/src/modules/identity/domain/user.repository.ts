import type { CreateUserInput, Role, UpdateUserProfileInput, User, UserStatus } from './user.model';

/** Dependency-injection token for {@link UserRepository}. */
export const USER_REPOSITORY = 'USER_REPOSITORY';

/**
 * Persistence port for the identity aggregate.
 *
 * Note: `phoneEncrypted` is deliberately absent. Phone numbers are never
 * returned through application code paths (`AGENTS.md` §9).
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;

  findByWechatOpenidHash(openidHash: string): Promise<User | null>;

  create(input: CreateUserInput): Promise<User>;

  /**
   * Create an account and grant its initial roles atomically.
   *
   * Used at first login: the role set is decided by the server, never by the
   * client (`AGENTS.md` §7).
   */
  createWithRoles(input: CreateUserInput, roles: Role[]): Promise<User>;

  /**
   * Update the account's own display fields.
   *
   * Only `displayName` / `avatarUrl` may change: roles, status and identity
   * hashes are never client-controlled (`AGENTS.md` §7).
   */
  updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User>;

  /** Idempotent: assigning an existing role is a no-op. */
  addRole(userId: string, role: Role): Promise<void>;

  /**
   * Revoking a role is an audited admin command (T019); the platform never
   * drops a role on its own.
   */
  removeRole(userId: string, role: Role): Promise<void>;

  listRoles(userId: string): Promise<Role[]>;

  /**
   * Suspend/restore an account. Never deletes: history must be preserved
   * (`AGENTS.md` §5 — soft delete where business history must be preserved).
   */
  setStatus(userId: string, status: UserStatus): Promise<void>;
}
