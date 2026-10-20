import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ROLES_METADATA_KEY } from '../../../src/modules/auth/http/decorators/roles.decorator';
import {
  readPrincipal,
  writePrincipal,
} from '../../../src/modules/auth/http/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../src/modules/auth/http/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../src/modules/auth/http/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../../src/modules/auth/http/guards/roles.guard';
import { AuthService } from '../../../src/modules/auth/domain/auth.service';
import type { ApiRole } from '@mentor/api-contracts';
import {
  FakeAccessTokenService,
  FakeConsoleCredentialRepository,
  FakeSessionRepository,
  FakeUserRepository,
  FakeWeChatAuthProvider,
  FastPasswordHasher,
} from './fakes';

const config = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 86_400,
  openidPepper: 'pepper',
  defaultRoles: ['USER' as const],
};

function buildService(): AuthService {
  return new AuthService(
    new FakeUserRepository(),
    new FakeSessionRepository(),
    new FakeAccessTokenService(),
    new FakeWeChatAuthProvider(),
    config,
    new FakeConsoleCredentialRepository(),
    new FastPasswordHasher(),
  );
}

function contextFor(request: unknown, handler?: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler ?? (() => undefined),
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

/** Build a RolesGuard whose handler declares the given roles. */
function buildRolesGuard(requiredRoles?: ApiRole[]): {
  guard: RolesGuard;
  context: (request: unknown) => ExecutionContext;
} {
  const handler = () => undefined;
  if (requiredRoles) {
    Reflect.defineMetadata(ROLES_METADATA_KEY, requiredRoles, handler);
  }
  return {
    guard: new RolesGuard(new Reflector()),
    context: (request: unknown) => contextFor(request, handler),
  };
}

function expectForbidden(work: () => void): void {
  let error: unknown;
  try {
    work();
  } catch (caught) {
    error = caught;
  }
  expect(error, 'expected a FORBIDDEN error').toBeDefined();
  expect((error as { status?: number }).status).toBe(403);
}

describe('JwtAuthGuard', () => {
  it('rejects a request without credentials', async () => {
    const guard = new JwtAuthGuard(buildService());

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('accepts a valid bearer token and attaches the principal', async () => {
    const service = buildService();
    const login = await service.loginWithWeChatCode({ code: 'code' });
    const guard = new JwtAuthGuard(service);
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${login.session.accessToken}` },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    const principal = readPrincipal(request);
    expect(principal?.userId).toBe(login.user.id);
    expect(principal?.roles).toEqual(['USER']);
  });

  it('rejects a tampered token with AUTH_REQUIRED', async () => {
    const guard = new JwtAuthGuard(buildService());
    const request = { headers: { authorization: 'Bearer not-a-real-token' } };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      response: { code: 'AUTH_REQUIRED' },
    });
  });

  it('rejects a token whose session was revoked (logout)', async () => {
    const service = buildService();
    const login = await service.loginWithWeChatCode({ code: 'code' });
    await service.logout({ refreshToken: login.session.refreshToken });

    const guard = new JwtAuthGuard(service);
    const request = { headers: { authorization: `Bearer ${login.session.accessToken}` } };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 401 });
  });

  it('optionally resolves the caller without rejecting anonymous requests', async () => {
    const service = buildService();
    const login = await service.loginWithWeChatCode({ code: 'code' });
    const guard = new OptionalJwtAuthGuard(service);

    const anonymous: Record<string, unknown> = { headers: {} };
    await expect(guard.canActivate(contextFor(anonymous))).resolves.toBe(true);
    expect(readPrincipal(anonymous)).toBeUndefined();

    const authenticated: Record<string, unknown> = {
      headers: { authorization: `Bearer ${login.session.accessToken}` },
    };
    await expect(guard.canActivate(contextFor(authenticated))).resolves.toBe(true);
    expect(readPrincipal(authenticated)?.userId).toBe(login.user.id);

    const invalid: Record<string, unknown> = { headers: { authorization: 'Bearer nope' } };
    await expect(guard.canActivate(contextFor(invalid))).resolves.toBe(true);
    expect(readPrincipal(invalid)).toBeUndefined();
  });
});

describe('RolesGuard', () => {
  it('allows routes without a role policy', () => {
    const { guard, context } = buildRolesGuard();
    expect(guard.canActivate(context({}))).toBe(true);
  });

  it('allows a principal holding the required role', () => {
    const request: Record<string, unknown> = {};
    writePrincipal(request, {
      userId: 'user-1',
      sessionId: 'session-1',
      accessTokenJti: 'jti-1',
      roles: ['USER', 'ADMIN'],
      status: 'ACTIVE',
    });

    const { guard, context } = buildRolesGuard(['ADMIN']);
    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('rejects a principal missing the required role', () => {
    const request: Record<string, unknown> = {};
    writePrincipal(request, {
      userId: 'user-1',
      sessionId: 'session-1',
      accessTokenJti: 'jti-1',
      roles: ['USER'],
      status: 'ACTIVE',
    });

    const { guard, context } = buildRolesGuard(['ADMIN']);
    expectForbidden(() => guard.canActivate(context(request)));
  });

  it('rejects an unauthenticated request', () => {
    const { guard, context } = buildRolesGuard(['ADMIN']);
    expectForbidden(() => guard.canActivate(context({})));
  });
});
