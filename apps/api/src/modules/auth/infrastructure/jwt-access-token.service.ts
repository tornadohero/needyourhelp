import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { invalidCredentials } from '../domain/auth-errors';
import type {
  AccessTokenClaims,
  AccessTokenService,
  IssuedAccessToken,
} from '../domain/access-token.service';

export interface JwtAccessTokenServiceOptions {
  /** HS256 signing secret. Must come from the environment/secret manager. */
  secret: string;
  ttlSeconds: number;
  issuer: string;
}

interface AccessTokenPayload extends jwt.JwtPayload {
  sub: string;
  sid: string;
  typ: string;
}

const TOKEN_TYPE = 'access';

/**
 * Short-lived access tokens.
 *
 * The session id (`sid`) is embedded so every request can be checked against the
 * session state, which makes logout/revocation effective immediately
 * (`specs/13-security-spec.md` §Authentication).
 */
export class JwtAccessTokenService implements AccessTokenService {
  constructor(private readonly options: JwtAccessTokenServiceOptions) {}

  async issue(input: AccessTokenClaims): Promise<IssuedAccessToken> {
    const expiresAt = input.expiresAt;
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) {
      // Access tokens are always short-lived; a past expiry is a caller bug.
      throw new Error('Access token expiry must be in the future.');
    }

    const token = jwt.sign({ sid: input.sessionId, typ: TOKEN_TYPE }, this.options.secret, {
      algorithm: 'HS256',
      subject: input.userId,
      jwtid: input.jti,
      issuer: this.options.issuer,
      expiresIn: ttlSeconds,
    });

    return { token, jti: input.jti, expiresAt, expiresIn: ttlSeconds };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, this.options.secret, {
        algorithms: ['HS256'],
        issuer: this.options.issuer,
      }) as AccessTokenPayload;
    } catch {
      // Expired, tampered or malformed tokens are all "authentication required".
      throw invalidCredentials('Access token is not valid.');
    }

    if (
      payload.typ !== TOKEN_TYPE ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      throw invalidCredentials('Access token is not valid.');
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
      expiresAt: new Date((payload.exp ?? 0) * 1000),
    };
  }

  /** Convenience for tests/factories: a random token id. */
  static newJti(): string {
    return randomUUID();
  }
}
