/**
 * Public identifier helpers.
 *
 * Rule (AGENTS.md §5): sequential DB ids are never exposed as public identifiers.
 */

export type PublicId = string & { readonly __brand: 'PublicId' };

const ID_PATTERN = /^[0-9a-zA-Z_-]{16,64}$/;

/** Create a new public identifier. Uses crypto.randomUUID when available. */
export function newPublicId(): PublicId {
  const raw = globalThis.crypto?.randomUUID?.();
  if (raw) {
    return raw as PublicId;
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') as PublicId;
}

export function isPublicId(value: unknown): value is PublicId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function assertPublicId(value: unknown, field = 'id'): PublicId {
  if (!isPublicId(value)) {
    throw new Error(`Invalid public identifier for "${field}".`);
  }
  return value;
}
