import { ApiError, TransportError } from './envelope';
import type { ApiClient } from './http';
import { ROUTES } from './routes';

/**
 * Session handling (T028).
 *
 * Access tokens are short-lived; refresh tokens are opaque and rotated on every
 * use (`README.md` §Auth). Three rules this file exists to enforce:
 *
 * 1. **one refresh at a time** — concurrent 401s share a single in-flight refresh
 *    instead of racing each other into an invalidated token;
 * 2. **retry exactly once** — a request that still fails after a refresh is a
 *    real failure, not something to loop on;
 * 3. **never invent a session** — if there is no refresh token, or the refresh is
 *    refused, the caller is told to log in again.
 */

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. Used to refresh a little early, not to decide validity. */
  expiresAt?: number;
}

export interface TokenStore {
  get(): SessionTokens | null;
  set(tokens: SessionTokens): void;
  clear(): void;
}

export class SessionExpiredError extends Error {
  constructor() {
    super('The session ended; the user must log in again.');
    this.name = 'SessionExpiredError';
  }
}

export interface SessionManagerOptions {
  client: ApiClient;
  store: TokenStore;
  /** Injected clock: tests must not depend on real time. */
  now?: () => number;
  /** Refresh this many seconds before the access token actually expires. */
  refreshSkewSeconds?: number;
}

export class SessionManager {
  private readonly client: ApiClient;
  private readonly store: TokenStore;
  private readonly now: () => number;
  private readonly refreshSkewSeconds: number;
  private refreshing: Promise<SessionTokens> | null = null;

  constructor(options: SessionManagerOptions) {
    this.client = options.client;
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.refreshSkewSeconds = options.refreshSkewSeconds ?? 60;
  }

  get tokens(): SessionTokens | null {
    return this.store.get();
  }

  get isSignedIn(): boolean {
    return this.store.get() !== null;
  }

  /**
   * `POST /auth/wechat/login`: exchange a `wx.login()` code for a session.
   *
   * The code is the only input — no role, no user id, no profile field.
   */
  async loginWithCode(code: string): Promise<SessionTokens> {
    const tokens = await this.client.post<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>(ROUTES.auth.wechatLogin, { body: { code } });

    const stored: SessionTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: this.now() / 1000 + (tokens.expiresIn ?? 900),
    };
    this.store.set(stored);
    return stored;
  }

  /** `true` when the access token is close enough to expiry to refresh first. */
  needsRefresh(): boolean {
    const tokens = this.store.get();
    if (!tokens?.expiresAt) {
      return false;
    }
    return tokens.expiresAt - this.refreshSkewSeconds <= Math.floor(this.now() / 1000);
  }

  /** Single-flight refresh. Throws {@link SessionExpiredError} when it is over. */
  async refresh(): Promise<SessionTokens> {
    if (this.refreshing) {
      return this.refreshing;
    }

    const current = this.store.get();
    if (!current) {
      throw new SessionExpiredError();
    }

    this.refreshing = (async () => {
      try {
        const refreshed = await this.client.post<{
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
        }>(ROUTES.auth.refresh, { body: { refreshToken: current.refreshToken } });

        const stored: SessionTokens = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: this.now() / 1000 + (refreshed.expiresIn ?? 900),
        };
        this.store.set(stored);
        return stored;
      } catch (error) {
        // A refused refresh means the session is over, not that the network failed.
        if (error instanceof ApiError) {
          this.store.clear();
          throw new SessionExpiredError();
        }
        throw error;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /**
   * Run an authenticated request: refresh before it when the token is about to
   * expire, and after it once when the server answers 401.
   */
  async withSession<T>(work: (accessToken: string) => Promise<T>): Promise<T> {
    if (this.needsRefresh()) {
      await this.refresh();
    }

    const tokens = this.store.get();
    if (!tokens) {
      throw new SessionExpiredError();
    }

    try {
      return await work(tokens.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) {
        throw error;
      }

      const refreshed = await this.refresh();
      return work(refreshed.accessToken);
    }
  }

  /** `POST /auth/logout`, then forget the session whatever the server answers. */
  async logout(): Promise<void> {
    const tokens = this.store.get();
    this.store.clear();

    if (!tokens) {
      return;
    }
    try {
      await this.client.post(ROUTES.auth.logout, { body: { refreshToken: tokens.refreshToken } });
    } catch (error) {
      // The session is gone locally; a failed call must not resurrect it.
      if (error instanceof TransportError) {
        return;
      }
      throw error;
    }
  }
}

/** In-memory store: the default when the platform has no storage (tests, previews). */
export class MemoryTokenStore implements TokenStore {
  private tokens: SessionTokens | null = null;

  get(): SessionTokens | null {
    return this.tokens;
  }

  set(tokens: SessionTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}
