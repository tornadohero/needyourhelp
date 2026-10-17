export const ACCESS_TOKEN_SERVICE = 'ACCESS_TOKEN_SERVICE';

export interface AccessTokenClaims {
  /** User id (`sub`). */
  userId: string;
  /** Session id. */
  sessionId: string;
  /** Unique token id, mirrored into `sessions.access_token_jti`. */
  jti: string;
  expiresAt: Date;
}

/** Signed access token plus its metadata. */
export interface IssuedAccessToken {
  token: string;
  jti: string;
  expiresAt: Date;
  expiresIn: number;
}

/**
 * Access-token port.
 *
 * Access tokens are short-lived (`specs/13-security-spec.md` §Authentication).
 * Verification must reject tampered, expired and wrong-type tokens.
 */
export interface AccessTokenService {
  issue(input: AccessTokenClaims): Promise<IssuedAccessToken>;

  verify(token: string): Promise<AccessTokenClaims>;
}
