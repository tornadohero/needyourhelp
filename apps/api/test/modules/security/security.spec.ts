import { describe, expect, it } from 'vitest';

import { InMemoryRateLimiter } from '../../../src/common/security/in-memory-rate-limiter';
import { RATE_LIMIT_POLICIES, policyFor } from '../../../src/common/security/rate-limit.model';
import { resolveCorsOptions } from '../../../src/common/security/cors-policy';

describe('rate limiting', () => {
  it('allows up to the limit and then refuses', async () => {
    const limiter = new InMemoryRateLimiter();
    const policy = { limit: 3, windowSeconds: 60, scope: 'ip' as const };

    const first = await limiter.consume('k', policy);
    const second = await limiter.consume('k', policy);
    const third = await limiter.consume('k', policy);
    const fourth = await limiter.consume('k', policy);

    expect([first, second, third].map((decision) => decision.allowed)).toEqual([true, true, true]);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    // The caller is told how long to wait, not just that it failed.
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fourth.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(third.remaining).toBe(0);
  });

  it('counts each caller separately', async () => {
    const limiter = new InMemoryRateLimiter();
    const policy = { limit: 1, windowSeconds: 60, scope: 'account' as const };

    await limiter.consume('account:a', policy);
    const other = await limiter.consume('account:b', policy);

    expect(other.allowed).toBe(true);
    expect((await limiter.consume('account:a', policy)).allowed).toBe(false);
  });

  it('starts a new window once the old one is over', async () => {
    const limiter = new InMemoryRateLimiter();
    // A one-second window: the test waits it out instead of faking the clock.
    const policy = { limit: 1, windowSeconds: 1, scope: 'ip' as const };

    expect((await limiter.consume('k', policy)).allowed).toBe(true);
    expect((await limiter.consume('k', policy)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect((await limiter.consume('k', policy)).allowed).toBe(true);
  });

  it('keeps the policies in one place, with a default for everything else', () => {
    expect(policyFor('auth.login')).toEqual(RATE_LIMIT_POLICIES['auth.login']);
    // An unknown name is never unlimited: it falls back to the default.
    expect(policyFor('nope')).toEqual(RATE_LIMIT_POLICIES.default);

    // The actions that cost money, reputation or a document are per account.
    expect(RATE_LIMIT_POLICIES['applications.create'].scope).toBe('account');
    expect(RATE_LIMIT_POLICIES['payments.session'].scope).toBe('account');
    expect(RATE_LIMIT_POLICIES['reviews.create'].scope).toBe('account');
    // Login and public search happen before there is an account.
    expect(RATE_LIMIT_POLICIES['auth.login'].scope).toBe('ip');
    expect(RATE_LIMIT_POLICIES['search.public'].scope).toBe('ip');
  });
});

describe('CORS allowlist', () => {
  it('is closed when nothing is configured', () => {
    expect(resolveCorsOptions(undefined).origin).toBe(false);
    expect(resolveCorsOptions('').origin).toBe(false);
    expect(resolveCorsOptions('   ').origin).toBe(false);
  });

  it('accepts only the named origins', () => {
    const options = resolveCorsOptions('https://admin.example.org, https://ops.example.org');
    expect(options.origin).toEqual(['https://admin.example.org', 'https://ops.example.org']);
  });

  it('refuses a wildcard: `*` is not an allowlist', () => {
    expect(resolveCorsOptions('*').origin).toBe(false);
    expect(resolveCorsOptions('https://ok.example.org, *').origin).toEqual([
      'https://ok.example.org',
    ]);
  });

  it('does not stay open in production without an allowlist', () => {
    expect(resolveCorsOptions(undefined, 'production').origin).toBe(false);
  });
});
