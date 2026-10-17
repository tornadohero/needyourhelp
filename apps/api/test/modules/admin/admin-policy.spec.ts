import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ROLES,
  DEFAULT_ADMIN_PAGE_SIZE,
  MAX_ADMIN_PAGE_SIZE,
  assertPage,
  assertPageSize,
  assertRole,
} from '../../../src/modules/admin/domain/admin-policy';

describe('operations policy', () => {
  it('keeps every listing bounded', () => {
    expect(assertPage(undefined)).toBe(1);
    expect(assertPage(3)).toBe(3);
    expect(() => assertPage(0)).toThrow(/page/);
    expect(() => assertPage(1.5)).toThrow(/page/);

    expect(assertPageSize(undefined)).toBe(DEFAULT_ADMIN_PAGE_SIZE);
    expect(assertPageSize(MAX_ADMIN_PAGE_SIZE)).toBe(MAX_ADMIN_PAGE_SIZE);
    // A page is never unbounded: an operations listing never scans a table.
    expect(() => assertPageSize(MAX_ADMIN_PAGE_SIZE + 1)).toThrow(/page size/);
    expect(() => assertPageSize(0)).toThrow(/page size/);
  });

  it('refuses a role it does not know', () => {
    expect(assertRole('admin')).toBe('ADMIN');
    expect(assertRole('OPS')).toBe('OPS');
    expect(() => assertRole('SUPERUSER')).toThrow(/Unknown role/);
    expect(() => assertRole('')).toThrow(/Unknown role/);
    // Every role of `specs/01` is assignable, so nothing needs a database edit.
    expect(ASSIGNABLE_ROLES).toContain('ADMIN');
    expect(ASSIGNABLE_ROLES).toContain('PROVIDER');
  });
});
