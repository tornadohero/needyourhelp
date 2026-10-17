import { taxonomyInvalid } from './taxonomy.errors';
import type { TaxonomyTerm, TaxonomyType } from './taxonomy.model';

/**
 * Catalog rules for taxonomy terms (`specs/05-api-spec.md` §Taxonomy,
 * `specs/04-database-spec.md` §taxonomy_terms).
 *
 * The taxonomy is shared platform configuration: a bad term silently breaks
 * service tagging (T009), search filters (T010) and the compliance scopes of
 * T007 (which store taxonomy *codes*), so the rules are enforced in the domain
 * rather than in the controller.
 */

/**
 * Stable machine key, matching the seeded V1 taxonomy (`MATH`, `PRIMARY_1`,
 * `HOMEWORK_SUPPORT`, `BEIJING`).
 */
export const TAXONOMY_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
export const MAX_TERM_NAME_LENGTH = 64;

/** A term tree is configuration, not user data: a bounded depth is enough. */
export const MAX_TAXONOMY_TREE_DEPTH = 8;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize a term code.
 *
 * Codes are case-insensitive on input and stored uppercase: they are compared
 * against the codes in compliance restrictions, which are normalized the same
 * way (T007).
 */
export function normalizeTaxonomyCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!TAXONOMY_CODE_PATTERN.test(code)) {
    throw taxonomyInvalid('A taxonomy code must be 1-64 characters of A-Z, 0-9 or underscore.');
  }
  return code;
}

/** Normalize a display name. */
export function normalizeTaxonomyName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_TERM_NAME_LENGTH) {
    throw taxonomyInvalid(`A taxonomy name must be 1-${MAX_TERM_NAME_LENGTH} characters.`);
  }
  return name;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Whether a term may be the parent of another.
 *
 * - a term cannot be its own parent;
 * - the hierarchy is per type: a city belongs under a city, a subject under a
 *   subject (`taxonomy_terms.parent_id` has no type of its own);
 * - an archived branch does not receive new children.
 */
export function assertUsableParent(
  parent: TaxonomyTerm,
  child: { id?: string; type: TaxonomyType },
): void {
  if (child.id !== undefined && parent.id === child.id) {
    throw taxonomyInvalid('A taxonomy term cannot be its own parent.');
  }
  if (parent.type !== child.type) {
    throw taxonomyInvalid(
      `A ${child.type} term can only be attached to another ${child.type} term.`,
    );
  }
  if (!parent.active) {
    throw taxonomyInvalid('An archived taxonomy term cannot be used as a parent.');
  }
}

/**
 * Whether `termId` already sits in the ancestor chain that starts at
 * `parentId`, i.e. whether the move would create a cycle.
 */
export function isAncestor(
  termId: string,
  ancestors: readonly { id: string; parentId: string | null }[],
): boolean {
  return ancestors.some((ancestor) => ancestor.id === termId);
}
