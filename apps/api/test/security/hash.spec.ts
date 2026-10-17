import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  hmacHex,
  randomSecret,
  sha256Hex,
  shortFingerprint,
} from '../../src/common/security/hash';

describe('security hashing helpers', () => {
  it('hashes deterministically and one-way', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
    expect(sha256Hex('abc')).toHaveLength(64);
    expect(sha256Hex('abc')).not.toContain('abc');
  });

  it('key-hashes identifiers so equal inputs differ per pepper', () => {
    const a = hmacHex('openid-1', 'pepper-a');
    const b = hmacHex('openid-1', 'pepper-b');

    expect(a).not.toBe(b);
    expect(a).toBe(hmacHex('openid-1', 'pepper-a'));
    expect(a).not.toBe(sha256Hex('openid-1'));
  });

  it('mints high-entropy secrets', () => {
    const first = randomSecret();
    const second = randomSecret();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url').length).toBe(32);
  });

  it('compares secret material in constant time', () => {
    expect(constantTimeEqual('token-a', 'token-a')).toBe(true);
    expect(constantTimeEqual('token-a', 'token-b')).toBe(false);
    expect(constantTimeEqual('short', 'much-longer')).toBe(false);
  });

  it('derives short display fingerprints', () => {
    expect(shortFingerprint('openid-1')).toHaveLength(8);
    expect(shortFingerprint('openid-1')).not.toBe(shortFingerprint('openid-2'));
  });
});
