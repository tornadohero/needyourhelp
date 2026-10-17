import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hashing helpers for secrets and identifiers.
 *
 * Rules implemented here:
 * - access/refresh tokens are only ever stored as hashes
 *   (`specs/04-database-spec.md` §sessions notes);
 * - WeChat identifiers are stored keyed-hashed so the database cannot be used
 *   as a plain lookup table of raw openids;
 * - comparisons of secret material are constant time.
 */

/** SHA-256 hex digest. Used for high-entropy random tokens (refresh tokens). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256 hex digest. Used for externally supplied identifiers. */
export function hmacHex(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

/** URL-safe random secret (refresh token). 32 bytes of entropy. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time string comparison. */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/** Short, non-reversible label derived from an identifier (e.g. display names). */
export function shortFingerprint(value: string, length = 8): string {
  return sha256Hex(value).slice(0, length);
}
