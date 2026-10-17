import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizeSearchQuery,
} from '../../../src/modules/discovery/domain/discovery-policy';
import { assertProviderId } from '../../../src/modules/discovery/domain/discovery-policy';

describe('discovery policy', () => {
  it('applies bounded defaults', () => {
    const query = normalizeSearchQuery({});

    expect(query).toMatchObject({
      domain: 'TUTORING',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: 'relevance',
      verifiedOnly: false,
      cityCode: null,
      subjectCode: null,
      gradeCode: null,
      deliveryMode: null,
      minPriceMinor: null,
      maxPriceMinor: null,
    });
  });

  it('upper-cases taxonomy codes and keeps enumerations', () => {
    const query = normalizeSearchQuery({
      domain: 'TUTORING',
      city: 'beijing',
      subject: 'math',
      grade: 'primary_1',
      providerType: 'TEACHER',
      deliveryMode: 'OFFLINE',
      sort: 'rating',
      verifiedOnly: true,
    });

    expect(query.cityCode).toBe('BEIJING');
    expect(query.subjectCode).toBe('MATH');
    expect(query.gradeCode).toBe('PRIMARY_1');
    expect(query.capabilityType).toBe('TEACHER');
    expect(query.deliveryMode).toBe('OFFLINE');
    expect(query.sort).toBe('rating');
    expect(query.verifiedOnly).toBe(true);
  });

  it('bounds paging so a public listing never scans the table', () => {
    expect(normalizeSearchQuery({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);

    for (const invalid of [{ page: 0 }, { pageSize: 0 }, { pageSize: MAX_PAGE_SIZE + 1 }]) {
      expect(() => normalizeSearchQuery(invalid), JSON.stringify(invalid)).toThrow();
    }
  });

  it('bounds the price filter and rejects an impossible range', () => {
    expect(normalizeSearchQuery({ minPrice: 0, maxPrice: 30_000 }).maxPriceMinor).toBe(30_000);

    for (const invalid of [
      { minPrice: -1 },
      { maxPrice: 1_000_001 },
      { minPrice: 30_000, maxPrice: 10_000 },
    ]) {
      expect(() => normalizeSearchQuery(invalid), JSON.stringify(invalid)).toThrow(/price/i);
    }
  });

  it('rejects unknown enumerations and malformed codes', () => {
    for (const invalid of [
      { domain: 'MEDICAL' },
      { providerType: 'WIZARD' },
      { deliveryMode: 'TELEPATHY' },
      { sort: 'cheapest' },
      { city: '北京!' },
    ]) {
      expect(() => normalizeSearchQuery(invalid), JSON.stringify(invalid)).toThrow();
    }
  });

  it('treats a non-uuid provider id as not found', () => {
    let thrown: unknown = null;
    try {
      assertProviderId('not-a-uuid');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(assertProviderId('00000000-0000-4000-8000-000000000001')).toContain('00000000');
  });
});
