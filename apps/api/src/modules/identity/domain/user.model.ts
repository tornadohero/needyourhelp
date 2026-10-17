/**
 * Domain view of the identity aggregate.
 *
 * Persistence-agnostic: repository adapters map Prisma rows onto these shapes so
 * application code never depends on ORM entities (`AGENTS.md` §6, §10).
 */

export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export type Role =
  'USER' | 'PARENT' | 'STUDENT' | 'PROVIDER' | 'ADMIN' | 'OPS' | 'FINANCE' | 'MODERATOR';

export interface User {
  id: string;
  status: UserStatus;
  /** SHA-256 hash of the WeChat openid. Raw identifiers are never stored. */
  wechatOpenidHash: string | null;
  unionidHash: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateUserInput {
  wechatOpenidHash?: string | null;
  unionidHash?: string | null;
  displayName: string;
  avatarUrl?: string | null;
}

/** Self-service profile fields (`PUT /me/profile`). */
export interface UpdateUserProfileInput {
  displayName?: string;
  avatarUrl?: string | null;
}
