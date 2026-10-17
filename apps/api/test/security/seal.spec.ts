import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { openJson, resolveSealingKey, sealJson } from '../../src/common/security/seal';
import { isMockAdapterAllowed } from '../../src/common/runtime/environment';

const KEY = createHash('sha256').update('seal-spec').digest();

describe('sealed metadata', () => {
  it('round-trips a payload', () => {
    const sealed = sealJson({ filename: 'diploma.pdf', byteSize: 42 }, KEY);
    expect(openJson(sealed, KEY)).toMatchObject({ filename: 'diploma.pdf', byteSize: 42 });
  });

  it('is non-deterministic: the same payload seals differently', () => {
    expect(sealJson({ a: 1 }, KEY)).not.toBe(sealJson({ a: 1 }, KEY));
  });

  it('does not leak the plaintext', () => {
    const sealed = sealJson({ filename: 'id-card.png' }, KEY);
    expect(Buffer.from(sealed, 'base64').toString('utf8')).not.toContain('id-card.png');
  });

  it('rejects tampering and foreign keys', () => {
    const sealed = sealJson({ filename: 'a.png' }, KEY);
    const raw = Buffer.from(sealed, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;

    expect(openJson<{ filename: string }>(raw.toString('base64'), KEY)).toBeNull();
    expect(openJson<{ filename: string }>(sealed, randomBytes(32))).toBeNull();
    expect(openJson<{ filename: string }>('not-base64!!', KEY)).toBeNull();
  });
});

describe('resolveSealingKey', () => {
  it('accepts base64 and hex keys of 32 bytes', () => {
    expect(resolveSealingKey(KEY.toString('base64'), 'test', 'K')).toEqual(KEY);
    expect(resolveSealingKey(KEY.toString('hex'), 'test', 'K')).toEqual(KEY);
  });

  it('refuses a wrong-sized key and production without a key', () => {
    expect(() => resolveSealingKey('c2hvcnQ=', 'test', 'K')).toThrow(/32 bytes/);
    expect(() => resolveSealingKey(undefined, 'production', 'K')).toThrow(/required in production/);
  });

  it('falls back to a development key outside production', () => {
    expect(resolveSealingKey(undefined, 'test', 'K').length).toBe(32);
  });
});

describe('mock adapter environments', () => {
  it('excludes production', () => {
    expect(isMockAdapterAllowed('local')).toBe(true);
    expect(isMockAdapterAllowed('test')).toBe(true);
    expect(isMockAdapterAllowed('production')).toBe(false);
    expect(isMockAdapterAllowed(undefined)).toBe(true);
  });
});
