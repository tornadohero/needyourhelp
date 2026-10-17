import type { ApiRole } from '@mentor/api-contracts';

import { adminInvalidRequest } from './admin.errors';

/**
 * Operations policy (`specs/12-admin-spec.md` §Admin principles,
 * `specs/07-permission-spec.md`).
 *
 * Least privilege is enforced in two places: the guard decides who may call an
 * operations route, and this file decides which roles an operator may hand out.
 */

export const DEFAULT_ADMIN_PAGE_SIZE = 20;
export const MAX_ADMIN_PAGE_SIZE = 50;

/**
 * Roles an operator may grant or revoke.
 *
 * `PROVIDER` stays assignable because a provider whose application was approved
 * before the role existed has to be repairable without a database edit — which
 * is what "the MVP must run without direct DB edits" (T019) asks for.
 */
export const ASSIGNABLE_ROLES: readonly ApiRole[] = [
  'USER',
  'PARENT',
  'STUDENT',
  'PROVIDER',
  'OPS',
  'FINANCE',
  'MODERATOR',
  'ADMIN',
];

export function assertPage(value: number | undefined): number {
  const page = value ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    throw adminInvalidRequest('A page must be a whole number of at least 1.');
  }
  return page;
}

export function assertPageSize(value: number | undefined): number {
  const pageSize = value ?? DEFAULT_ADMIN_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_ADMIN_PAGE_SIZE) {
    throw adminInvalidRequest(`A page size must be between 1 and ${MAX_ADMIN_PAGE_SIZE}.`);
  }
  return pageSize;
}

/** An unknown role is never invented: it is refused. */
export function assertRole(value: string): ApiRole {
  const role = value.trim().toUpperCase();
  if (!ASSIGNABLE_ROLES.includes(role as ApiRole)) {
    throw adminInvalidRequest(`Unknown role ${value}.`);
  }
  return role as ApiRole;
}
