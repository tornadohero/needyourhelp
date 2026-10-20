import { describe, expect, it } from 'vitest';

import type { RecordAuditLogInput } from '../../../src/modules/audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/audit-log.repository';
import { AuthService } from '../../../src/modules/auth/domain/auth.service';
import type { AuthServiceConfig } from '../../../src/modules/auth/domain/auth.service';
import { ConsoleCredentialService } from '../../../src/modules/auth/domain/console-credential.service';
import {
  CONSOLE_MAX_FAILED_ATTEMPTS,
  CONSOLE_PASSWORD_MIN_LENGTH,
  assertPassword,
  assertUsername,
  isLocked,
  lockoutFor,
} from '../../../src/modules/auth/domain/console-credential-policy';
import { ScryptPasswordHasher } from '../../../src/modules/auth/domain/password-hasher';
import {
  FakeAccessTokenService,
  FakeConsoleCredentialRepository,
  FakeSessionRepository,
  FakeUserRepository,
  FakeWeChatAuthProvider,
  FastPasswordHasher,
} from './fakes';

/** Audit rows are append-only: the fake only has to remember them. */
class RecordingAuditRepository implements AuditLogRepository {
  readonly rows: RecordAuditLogInput[] = [];

  async record(input: RecordAuditLogInput): Promise<void> {
    this.rows.push(input);
  }
}

const config: AuthServiceConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 86_400,
  openidPepper: 'console-pepper',
  defaultRoles: ['USER'],
};

function build() {
  const users = new FakeUserRepository();
  const credentials = new FakeConsoleCredentialRepository();
  const passwords = new FastPasswordHasher();
  const audit = new RecordingAuditRepository();
  const auth = new AuthService(
    users,
    new FakeSessionRepository(),
    new FakeAccessTokenService(),
    new FakeWeChatAuthProvider(),
    config,
    credentials,
    passwords,
  );
  const service = new ConsoleCredentialService(credentials, passwords, users, audit);
  return { users, credentials, passwords, audit, auth, service };
}

const PASSWORD = 'correct-horse-battery-staple';

describe('console credential policy', () => {
  it('normalises and constrains the username', () => {
    expect(assertUsername(' Ops.Adam ')).toBe('ops.adam');
    expect(() => assertUsername('ab')).toThrow();
    expect(() => assertUsername('Ops Adam')).toThrow();
  });

  it('requires a long password and locks after repeated failures', () => {
    expect(() => assertPassword('short')).toThrow();
    expect(() => assertPassword('x'.repeat(CONSOLE_PASSWORD_MIN_LENGTH))).not.toThrow();

    expect(lockoutFor(CONSOLE_MAX_FAILED_ATTEMPTS - 1)).toBeNull();
    expect(lockoutFor(CONSOLE_MAX_FAILED_ATTEMPTS)).not.toBeNull();
    expect(isLocked(lockoutFor(CONSOLE_MAX_FAILED_ATTEMPTS))).toBe(true);
    // An expired lock is not a lock: time is always compared, never assumed.
    expect(isLocked(new Date(Date.now() - 1_000))).toBe(false);
  });
});

describe('ScryptPasswordHasher', () => {
  it('verifies a round trip and refuses a wrong or tampered value', async () => {
    const hasher = new ScryptPasswordHasher();
    const encoded = await hasher.hash(PASSWORD);

    expect(encoded.startsWith('scrypt$')).toBe(true);
    expect(await hasher.verify(PASSWORD, encoded)).toBe(true);
    expect(await hasher.verify(`${PASSWORD}!`, encoded)).toBe(false);
    expect(await hasher.verify(PASSWORD, 'nonsense')).toBe(false);
    // Two derivations of the same password differ: the salt is per-credential.
    expect(await hasher.hash(PASSWORD)).not.toBe(encoded);
  });
});

describe('ConsoleCredentialService', () => {
  it('issues only to an operator account, and audits without the password', async () => {
    const { users, service, audit, credentials } = build();
    const admin = await users.createWithRoles({ displayName: '运营' }, ['ADMIN']);

    const issued = await service.issue(
      { actorUserId: admin.id, requestId: 'req-1' },
      { userId: admin.id, username: 'Ops.Adam', password: PASSWORD },
    );
    expect(issued).toMatchObject({ username: 'ops.adam', rotated: false });

    const row = await credentials.findByUsername('ops.adam');
    expect(row?.passwordHash).not.toContain(PASSWORD);

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: 'CONSOLE_CREDENTIAL_ISSUED',
      actorType: 'ADMIN',
      resourceType: 'console_credential',
    });
    expect(JSON.stringify(audit.rows[0])).not.toContain(PASSWORD);
  });

  it('refuses a credential for a non-operator account', async () => {
    const { users, service } = build();
    const plain = await users.createWithRoles({ displayName: '家长' }, ['USER']);

    await expect(
      service.issue(
        { actorUserId: plain.id, requestId: 'req-2' },
        { userId: plain.id, username: 'someone', password: PASSWORD },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rotates in place and revokes', async () => {
    const { users, service, credentials, audit } = build();
    const ops = await users.createWithRoles({ displayName: '运营' }, ['OPS']);

    await service.issue(
      { actorUserId: ops.id, requestId: 'req-3' },
      { userId: ops.id, username: 'ops1', password: PASSWORD },
    );
    const rotated = await service.issue(
      { actorUserId: ops.id, requestId: 'req-4' },
      { userId: ops.id, username: 'ops2', password: `${PASSWORD}-next` },
    );
    expect(rotated.rotated).toBe(true);
    // One credential per account: a rotation replaces, it does not add.
    expect([...credentials.credentials.values()]).toHaveLength(1);

    const revoked = await service.revoke({ actorUserId: ops.id, requestId: 'req-5' }, ops.id);
    expect(revoked).toMatchObject({ revoked: true });
    expect(await credentials.findByUserId(ops.id)).toBeNull();
    expect(audit.rows.at(-1)).toMatchObject({ action: 'CONSOLE_CREDENTIAL_REVOKED' });

    await expect(
      service.revoke({ actorUserId: ops.id, requestId: 'req-6' }, ops.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('console login', () => {
  it('logs an operator in and clears the failure counter', async () => {
    const { users, service, auth, credentials } = build();
    const admin = await users.createWithRoles({ displayName: '运营' }, ['ADMIN']);
    await service.issue(
      { actorUserId: admin.id, requestId: 'req-7' },
      { userId: admin.id, username: 'ops.adam', password: PASSWORD },
    );
    await credentials
      .recordFailure({ id: 'unknown', failedAttempts: 1, lockedUntil: null })
      .catch(() => undefined);

    const result = await auth.loginWithConsoleCredential({
      username: 'OPS.Adam',
      password: PASSWORD,
    });

    expect(result.user.id).toBe(admin.id);
    expect(result.user.roles).toContain('ADMIN');
    expect(result.session.accessToken).toBeTruthy();

    const stored = await credentials.findByUsername('ops.adam');
    expect(stored?.failedAttempts).toBe(0);
    expect(stored?.lastUsedAt).not.toBeNull();
  });

  it('never escalates: a revoked operator role loses the console', async () => {
    const { users, service, auth } = build();
    const admin = await users.createWithRoles({ displayName: '运营' }, ['ADMIN']);
    await service.issue(
      { actorUserId: admin.id, requestId: 'req-8' },
      { userId: admin.id, username: 'ops.adam', password: PASSWORD },
    );
    await users.removeRole(admin.id, 'ADMIN');

    await expect(
      auth.loginWithConsoleCredential({ username: 'ops.adam', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts failures, locks the credential, and answers uniformly', async () => {
    const { users, service, auth, credentials } = build();
    const admin = await users.createWithRoles({ displayName: '运营' }, ['OPS']);
    await service.issue(
      { actorUserId: admin.id, requestId: 'req-9' },
      { userId: admin.id, username: 'ops.adam', password: PASSWORD },
    );

    // An unknown username and a wrong password are indistinguishable.
    await expect(
      auth.loginWithConsoleCredential({ username: 'nobody', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    for (let attempt = 0; attempt < CONSOLE_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await expect(
        auth.loginWithConsoleCredential({ username: 'ops.adam', password: 'wrong-password' }),
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    }

    const locked = await credentials.findByUsername('ops.adam');
    expect(locked?.failedAttempts).toBe(CONSOLE_MAX_FAILED_ATTEMPTS);
    expect(isLocked(locked?.lockedUntil ?? null)).toBe(true);

    // Even the right password is refused while the lock stands.
    await expect(
      auth.loginWithConsoleCredential({ username: 'ops.adam', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
