import type { MeResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { describeAccount, hasRole, isSuspended, looksLikeGuardian, roleLabel } from './account';

function user(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user-1',
    displayName: '张家长',
    avatarUrl: null,
    status: 'ACTIVE',
    roles: ['USER'],
    ...overrides,
  };
}

describe('describeAccount', () => {
  it('renders what the server said, and nothing it did not', () => {
    const account = describeAccount(user({ roles: ['PARENT', 'USER'] }));

    expect(account).toMatchObject({
      id: 'user-1',
      name: '张家长',
      suspended: false,
      statusText: '正常',
      roleText: '家长 · 用户',
    });
  });

  it('shows a suspended account instead of pretending it works', () => {
    const account = describeAccount(user({ status: 'SUSPENDED' }));

    expect(account.suspended).toBe(true);
    expect(account.statusText).toContain('停用');
  });

  it('renders an account with no roles without inventing one', () => {
    const account = describeAccount(user({ roles: [] }));
    expect(account.roleText).toBe('未分配角色');
  });

  it('copies the roles so a screen cannot mutate the session', () => {
    const source = user({ roles: ['PARENT'] });
    const account = describeAccount(source);
    account.roles.push('ADMIN');

    expect(source.roles).toEqual(['PARENT']);
  });
});

describe('roles', () => {
  it('labels the roles the platform defines', () => {
    expect(roleLabel('PARENT')).toBe('家长');
    expect(roleLabel('PROVIDER')).toBe('导师');
    expect(roleLabel('MODERATOR')).toBe('审核');
  });

  it('answers membership without granting anything', () => {
    expect(hasRole(user({ roles: ['PROVIDER'] }), 'PROVIDER')).toBe(true);
    expect(hasRole(user({ roles: ['PROVIDER'] }), 'ADMIN')).toBe(false);
  });

  it('is only a hint: a suspended account is not treated as a guardian', () => {
    expect(looksLikeGuardian(user({ roles: ['PARENT'] }))).toBe(true);
    expect(looksLikeGuardian(user({ roles: ['PARENT'], status: 'SUSPENDED' }))).toBe(false);
  });

  it('detects suspension from the server status alone', () => {
    expect(isSuspended(user())).toBe(false);
    expect(isSuspended(user({ status: 'SUSPENDED' }))).toBe(true);
  });
});
