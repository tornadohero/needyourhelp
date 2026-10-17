import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { JwtAccessTokenService } from '../../../src/modules/auth/infrastructure/jwt-access-token.service';

const SECRET = 'unit-test-secret';
const ISSUER = 'mentor-platform';

function service(overrides: { secret?: string; issuer?: string } = {}): JwtAccessTokenService {
  return new JwtAccessTokenService({
    secret: overrides.secret ?? SECRET,
    ttlSeconds: 900,
    issuer: overrides.issuer ?? ISSUER,
  });
}

describe('JwtAccessTokenService', () => {
  it('issues a verifiable short-lived token', async () => {
    const issued = await service().issue({
      userId: 'user-1',
      sessionId: 'session-1',
      jti: 'jti-1',
      expiresAt: new Date(Date.now() + 900_000),
    });

    expect(issued.token.split('.')).toHaveLength(3);
    expect(issued.expiresIn).toBeGreaterThan(0);

    const claims = await service().verify(issued.token);
    expect(claims.userId).toBe('user-1');
    expect(claims.sessionId).toBe('session-1');
    expect(claims.jti).toBe('jti-1');
  });

  it('rejects a token signed with another secret', async () => {
    const issued = await service({ secret: 'another-secret' }).issue({
      userId: 'user-1',
      sessionId: 'session-1',
      jti: 'jti-1',
      expiresAt: new Date(Date.now() + 900_000),
    });

    await expect(service().verify(issued.token)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects an expired token', async () => {
    // Signed directly so the `exp` claim is already in the past.
    const expired = jwt.sign(
      { sid: 'session-1', typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
      { algorithm: 'HS256', subject: 'user-1', jwtid: 'jti-1', issuer: ISSUER },
    );

    await expect(service().verify(expired)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('refuses to issue a token that is already expired', async () => {
    await expect(
      service().issue({
        userId: 'user-1',
        sessionId: 'session-1',
        jti: 'jti-1',
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('rejects a token from another issuer', async () => {
    const issued = await service({ issuer: 'other' }).issue({
      userId: 'user-1',
      sessionId: 'session-1',
      jti: 'jti-1',
      expiresAt: new Date(Date.now() + 900_000),
    });

    await expect(service().verify(issued.token)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects malformed input', async () => {
    await expect(service().verify('not-a-token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(service().verify('')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
