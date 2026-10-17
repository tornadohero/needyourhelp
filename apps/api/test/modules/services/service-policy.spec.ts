import { describe, expect, it } from 'vitest';

import {
  MAX_SERVICE_PRICE_MINOR,
  MAX_SERVICE_TITLE_LENGTH,
  MAX_TERMS_PER_TYPE,
  MIN_SERVICE_PRICE_MINOR,
  SERVICE_TRANSITIONS,
  assertCurrency,
  assertDescription,
  assertDurationMinutes,
  assertPriceMinor,
  assertTagging,
  assertTitle,
  canTransition,
  isEditable,
  isPublished,
  normalizeTermCodes,
} from '../../../src/modules/services/domain/service-policy';
import type { ServiceTermRef } from '../../../src/modules/services/domain/service.model';

function term(type: ServiceTermRef['type'], code: string): ServiceTermRef {
  return { termId: `term-${code}`, type, code, name: code };
}

describe('service policy', () => {
  it('accepts only whole durations inside the bounds', () => {
    expect(assertDurationMinutes(60)).toBe(60);
    for (const duration of [0, 10, 481, 60.5]) {
      expect(() => assertDurationMinutes(duration), String(duration)).toThrow(/duration/);
    }
  });

  it('accepts only integer minor-unit prices inside the bounds', () => {
    expect(assertPriceMinor(MIN_SERVICE_PRICE_MINOR)).toBe(MIN_SERVICE_PRICE_MINOR);
    expect(assertPriceMinor(MAX_SERVICE_PRICE_MINOR)).toBe(MAX_SERVICE_PRICE_MINOR);

    // Money is never a float (`AGENTS.md` §8) and never free.
    for (const price of [0, 99, MAX_SERVICE_PRICE_MINOR + 1, 199.99]) {
      expect(() => assertPriceMinor(price), String(price)).toThrow(/price/);
    }
  });

  it('normalizes and bounds the title', () => {
    expect(assertTitle('  数学一对一  ')).toBe('数学一对一');
    expect(() => assertTitle('   ')).toThrow(/title/);
    expect(() => assertTitle('名'.repeat(MAX_SERVICE_TITLE_LENGTH + 1))).toThrow(/title/);
  });

  it('treats a blank description as absent and bounds it', () => {
    expect(assertDescription(undefined)).toBeNull();
    expect(assertDescription(null)).toBeNull();
    expect(assertDescription('   ')).toBeNull();
    expect(assertDescription(' 课程内容 ')).toBe('课程内容');
    expect(() => assertDescription('课'.repeat(2001))).toThrow(/description/);
  });

  it('upper-cases the currency and requires three letters', () => {
    expect(assertCurrency('cny')).toBe('CNY');
    expect(() => assertCurrency('US')).toThrow(/currency/);
    expect(() => assertCurrency('CNY1')).toThrow(/currency/);
  });

  it('normalizes taxonomy codes and rejects more than the per-type limit', () => {
    expect(normalizeTermCodes(['math', 'MATH', ' primary_1 '])).toEqual(['MATH', 'PRIMARY_1']);
    expect(normalizeTermCodes(undefined)).toEqual([]);

    const tooMany = Array.from({ length: MAX_TERMS_PER_TYPE + 1 }, (_, index) => `C${index}`);
    expect(() => normalizeTermCodes(tooMany)).toThrow(/tags/);
    expect(() => normalizeTermCodes(['数学'])).toThrow(/taxonomy code/);
  });

  it('requires what the service offers, per marketplace', () => {
    expect(() => assertTagging('TUTORING', [term('SUBJECT', 'MATH')])).not.toThrow();
    expect(() => assertTagging('TUTORING', [term('GRADE', 'PRIMARY_1')])).toThrow(/subject/);
    // A career service publishes expertise: at least one skill (T021).
    expect(() => assertTagging('CAREER', [term('SKILL', 'RESUME')])).not.toThrow();
    expect(() => assertTagging('CAREER', [])).toThrow(/skill/);
    expect(() => assertTagging('CAREER', [term('GRADE', 'PRIMARY_1')])).toThrow(/skill/);
  });

  it('allows only the transitions of the publication state machine', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransition('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransition('PUBLISHED', 'UNPUBLISHED')).toBe(true);
    expect(canTransition('UNPUBLISHED', 'PUBLISHED')).toBe(true);
    expect(canTransition('REJECTED', 'PUBLISHED')).toBe(true);

    // No way back from PUBLISHED except UNPUBLISHED, and UNPUBLISHED is not DRAFT.
    expect(canTransition('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransition('UNPUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransition('DRAFT', 'UNPUBLISHED')).toBe(false);

    // Every status is a key of the table: no state is left unhandled.
    expect(Object.keys(SERVICE_TRANSITIONS)).toHaveLength(5);
  });

  it('edits a service only while it is not published', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('REJECTED')).toBe(true);
    expect(isEditable('UNPUBLISHED')).toBe(true);
    expect(isEditable('PUBLISHED')).toBe(false);
    expect(isEditable('PENDING_REVIEW')).toBe(false);
  });

  it('knows what is published', () => {
    expect(isPublished('PUBLISHED')).toBe(true);
    expect(isPublished('UNPUBLISHED')).toBe(false);
    expect(isPublished('DRAFT')).toBe(false);
  });
});
