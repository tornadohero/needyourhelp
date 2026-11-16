import { describe, expect, it } from 'vitest';

// The Node test can read the real contract; the app itself must not require it.
import {
  DELIVERY_MODES as CONTRACT_DELIVERY_MODES,
  PROVIDER_SORTS as CONTRACT_PROVIDER_SORTS,
} from '@mentor/api-contracts';

import {
  DEFAULT_FILTER,
  DELIVERY_MODES,
  PROVIDER_SORTS,
  activeFilterCount,
  filterSummary,
  isDefaultFilter,
  normalizeFilter,
  toSearchQuery,
} from './filters';

describe('contract drift', () => {
  it('the locally mirrored values stay identical to the contract', () => {
    // The app ships literals because devtools cannot resolve the workspace
    // package; this test is the thing that keeps the copy honest.
    expect([...DELIVERY_MODES]).toEqual([...CONTRACT_DELIVERY_MODES]);
    expect([...PROVIDER_SORTS]).toEqual([...CONTRACT_PROVIDER_SORTS]);
  });
});

describe('the new hard filters', () => {
  it('adds rating and experience bounds to the query the server reads', () => {
    const filter = normalizeFilter({ minRating: 4.5, minCompletedOrders: 30 });
    expect(toSearchQuery(filter)).toMatchObject({ minRating: 4.5, minCompletedOrders: 30 });
  });

  it('drops an out-of-range rating and a fractional lesson count', () => {
    const filter = normalizeFilter({ minRating: 9, minCompletedOrders: 1.5 });
    expect(filter.minRating).toBeNull();
    expect(filter.minCompletedOrders).toBeNull();
    expect(toSearchQuery(filter)).not.toHaveProperty('minRating');
  });

  it('summarises in Chinese, including the city and the distance wording', () => {
    const summary = filterSummary(
      normalizeFilter({ city: 'beijing', deliveryMode: 'OFFLINE', minRating: 4.5 }),
    );
    expect(summary).toContain('城市 北京');
    expect(summary).toContain('距离 同城线下');
    expect(summary).toContain('评分 4.5 分以上');
  });
});

describe('normalizeFilter', () => {
  it('starts from the documented defaults', () => {
    const filter = normalizeFilter();
    expect(filter).toEqual(DEFAULT_FILTER);
    expect(isDefaultFilter(filter)).toBe(true);
  });

  it('upper-cases codes, because that is what the server stores', () => {
    const filter = normalizeFilter({ city: ' beijing ', subject: 'math' });
    expect(filter.city).toBe('BEIJING');
    expect(filter.subject).toBe('MATH');
  });

  it('drops a delivery mode or sort the API does not define', () => {
    // Sending them would be answered with VALIDATION_ERROR, so they never leave.
    expect(normalizeFilter({ deliveryMode: 'TELEPATHY' as never }).deliveryMode).toBe('');
    expect(normalizeFilter({ sort: 'cheapest' as never }).sort).toBe('relevance');
  });

  it('drops an inverted price range instead of swapping it silently', () => {
    const filter = normalizeFilter({ minPrice: 5000, maxPrice: 1000 });
    expect(filter.minPrice).toBeNull();
    expect(filter.maxPrice).toBeNull();
  });

  it('truncates money to whole minor units', () => {
    expect(normalizeFilter({ minPrice: 100.9 }).minPrice).toBe(100);
    expect(normalizeFilter({ maxPrice: -5 }).maxPrice).toBeNull();
  });
});

describe('toSearchQuery', () => {
  it('sends only the filters that are set', () => {
    expect(toSearchQuery(DEFAULT_FILTER)).toEqual({ domain: 'TUTORING' });
    expect(toSearchQuery(normalizeFilter({ city: 'beijing', verifiedOnly: true }))).toEqual({
      domain: 'TUTORING',
      city: 'BEIJING',
      verifiedOnly: true,
    });
  });

  it('omits the default sort rather than spelling it out', () => {
    expect(toSearchQuery(normalizeFilter({ sort: 'rating' })).sort).toBe('rating');
    expect(toSearchQuery(DEFAULT_FILTER).sort).toBeUndefined();
  });
});

describe('activeFilterCount', () => {
  it('counts what narrowed the list, ignoring domain and sort', () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    expect(activeFilterCount(normalizeFilter({ city: 'BEIJING', verifiedOnly: true }))).toBe(2);
  });
});

describe('filterSummary', () => {
  it('describes the active filters in the user language', () => {
    const chips = filterSummary(
      normalizeFilter({ city: 'beijing', subject: 'MATH', minPrice: 20000 }),
    );
    expect(chips).toContain('城市 北京');
    expect(chips).toContain('科目 MATH');
    expect(chips.some((chip) => chip.includes('200 元'))).toBe(true);
  });

  it('answers nothing when nothing is filtered', () => {
    expect(filterSummary(DEFAULT_FILTER)).toEqual([]);
  });
});
