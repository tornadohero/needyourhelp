import { describe, expect, it } from 'vitest';

import {
  MAX_TAXONOMY_TREE_DEPTH,
  assertUsableParent,
  isAncestor,
  isUuid,
  normalizeTaxonomyCode,
  normalizeTaxonomyName,
} from '../../../src/modules/catalog/domain/taxonomy-policy';
import type {
  TaxonomyTerm,
  TaxonomyType,
} from '../../../src/modules/catalog/domain/taxonomy.model';

function term(overrides: Partial<TaxonomyTerm> = {}): TaxonomyTerm {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'SUBJECT',
    code: 'MATH',
    name: '数学',
    parentId: null,
    active: true,
    ...overrides,
  };
}

describe('taxonomy policy', () => {
  it('normalizes codes to the stored uppercase form', () => {
    expect(normalizeTaxonomyCode('math')).toBe('MATH');
    expect(normalizeTaxonomyCode(' home_work ')).toBe('HOME_WORK');
    expect(normalizeTaxonomyCode('PRIMARY_1')).toBe('PRIMARY_1');
  });

  it('rejects codes that are not stable machine keys', () => {
    for (const code of ['', ' ', '数学', 'MATH-1', 'MATH!', 'A'.repeat(65)]) {
      expect(() => normalizeTaxonomyCode(code), code).toThrow(/taxonomy code/);
    }
  });

  it('normalizes and bounds the display name', () => {
    expect(normalizeTaxonomyName('  数学  ')).toBe('数学');
    expect(() => normalizeTaxonomyName('   ')).toThrow(/taxonomy name/);
    expect(() => normalizeTaxonomyName('名'.repeat(65))).toThrow(/taxonomy name/);
  });

  it('recognizes uuids only', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('keeps the hierarchy inside one type', () => {
    const parent = term();
    expect(() => assertUsableParent(parent, { type: 'SUBJECT' })).not.toThrow();
    expect(() => assertUsableParent(parent, { type: 'CITY' as TaxonomyType })).toThrow(
      /only be attached to/,
    );
  });

  it('refuses a self-parent and an archived parent', () => {
    expect(() => assertUsableParent(term(), { id: term().id, type: 'SUBJECT' })).toThrow(
      /own parent/,
    );
    expect(() => assertUsableParent(term({ active: false }), { type: 'SUBJECT' })).toThrow(
      /archived taxonomy term/,
    );
  });

  it('detects a term inside the ancestor chain', () => {
    const chain = [
      { id: 'parent', parentId: null },
      { id: 'root', parentId: null },
    ];
    expect(isAncestor('parent', chain)).toBe(true);
    expect(isAncestor('child', chain)).toBe(false);
    expect(isAncestor('child', [])).toBe(false);
  });

  it('bounds the tree depth', () => {
    expect(MAX_TAXONOMY_TREE_DEPTH).toBeGreaterThan(0);
  });
});
