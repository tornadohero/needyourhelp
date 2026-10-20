/** Dependency-injection token for {@link ConsoleCredentialRepository}. */
export const CONSOLE_CREDENTIAL_REPOSITORY = 'CONSOLE_CREDENTIAL_REPOSITORY';

/**
 * Storage for admin console credentials (T028 gap G1).
 *
 * Only the derived password is stored, and the port never exposes it to the
 * HTTP layer: the mapper of every response is a whitelist.
 */
export interface ConsoleCredentialRecord {
  id: string;
  userId: string;
  username: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConsoleCredentialRepository {
  /** Usernames are unique and stored normalised. */
  findByUsername(username: string): Promise<ConsoleCredentialRecord | null>;

  findByUserId(userId: string): Promise<ConsoleCredentialRecord | null>;

  /** Issue or rotate: one credential per account, one username per platform. */
  upsert(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<ConsoleCredentialRecord>;

  deleteByUserId(userId: string): Promise<void>;

  /** A failed login: counted, and frozen once the threshold is reached. */
  recordFailure(input: {
    id: string;
    failedAttempts: number;
    lockedUntil: Date | null;
  }): Promise<ConsoleCredentialRecord>;

  /** A successful login clears the counter. */
  recordSuccess(id: string): Promise<ConsoleCredentialRecord>;
}
