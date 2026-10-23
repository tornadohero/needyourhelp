import { describe, expect, it } from 'vitest';

import { createRedisHandle, redisKey, resolveRedisUrl } from './redis.client';

describe('resolveRedisUrl', () => {
  it('treats an absent or blank url as "no Redis"', () => {
    expect(resolveRedisUrl(undefined)).toBeNull();
    expect(resolveRedisUrl(null)).toBeNull();
    expect(resolveRedisUrl('')).toBeNull();
    expect(resolveRedisUrl('   ')).toBeNull();
  });

  it('accepts an explicit opt-out, so an environment can say so', () => {
    expect(resolveRedisUrl('disabled')).toBeNull();
    expect(resolveRedisUrl('DISABLED')).toBeNull();
  });

  it('keeps a configured url', () => {
    expect(resolveRedisUrl('redis://localhost:6379')).toBe('redis://localhost:6379');
    expect(resolveRedisUrl(' rediss://cache.example.com:6380 ')).toBe(
      'rediss://cache.example.com:6380',
    );
  });
});

describe('createRedisHandle', () => {
  it('is disabled — not broken — when Redis is not configured', async () => {
    const handle = await createRedisHandle('');

    expect(handle.enabled).toBe(false);
    expect(handle.client).toBeNull();
    // Closing a handle that never connected must not throw.
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('connects when a url is configured, and reports it', async () => {
    const handle = await createRedisHandle('redis://127.0.0.1:6399');

    expect(handle.enabled).toBe(true);
    expect(handle.url).toBe('redis://127.0.0.1:6399');
    expect(handle.client).not.toBeNull();

    // Nothing listens on that port; quitting must not hang the shutdown.
    await handle.close();
  });
});

describe('redisKey', () => {
  it('namespaces every key the platform writes', () => {
    expect(redisKey('rate-limit', 'ip:1')).toBe('mentor:rate-limit:ip:1');
    expect(redisKey('idempotency', 'refunds', 'k1')).toBe('mentor:idempotency:refunds:k1');
  });
});
