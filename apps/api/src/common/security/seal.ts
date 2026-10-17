import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for small metadata blobs at rest.
 *
 * `specs/10-privacy-and-minors.md` §Verification documents requires encrypted
 * metadata, and `AGENTS.md` §9 requires encryption at rest where supported.
 * AES-256-GCM is used so tampering is detected, not merely hidden.
 *
 * The key is never derived from data and never stored next to the ciphertext.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** `base64(iv | tag | ciphertext)`. */
export function sealJson(value: unknown, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Returns `null` when the blob was tampered with or sealed with another key. */
export function openJson<T>(sealed: string, key: Buffer): T | null {
  assertKey(key);
  try {
    const raw = Buffer.from(sealed, 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      return null;
    }
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a 32-byte key from configuration.
 *
 * Accepts base64 or hex. A missing key is fatal in production; isolated
 * dev/test environments fall back to a fixed, non-secret key so the suite and
 * local runs work without configuration.
 */
export function resolveSealingKey(
  configured: string | undefined,
  environment: string | undefined,
  label: string,
): Buffer {
  const trimmed = configured?.trim();
  if (trimmed) {
    const key = decodeKey(trimmed);
    if (key) {
      return key;
    }
    throw new Error(`${label} must be ${KEY_BYTES} bytes (base64 or hex).`);
  }

  const normalized = (environment ?? 'local').toLowerCase();
  if (normalized === 'production') {
    throw new Error(`${label} is required in production.`);
  }

  console.warn(`${label} is not configured; using a development-only key.`);
  return createHash('sha256').update(`mentor-dev:${label}`).digest();
}

function decodeKey(value: string): Buffer | null {
  for (const encoding of ['base64', 'hex'] as const) {
    const buffer = Buffer.from(value, encoding);
    if (buffer.length === KEY_BYTES) {
      return buffer;
    }
  }
  return null;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Sealing key must be ${KEY_BYTES} bytes.`);
  }
}
