import { describe, expect, it } from 'vitest';

import {
  MAX_DURATION_MINUTES,
  MAX_PRICE_MINOR,
  MIN_DURATION_MINUTES,
  SERVICE_TITLE_MAX,
  ServiceInvalidError,
  minorToYuan,
  newServiceDraft,
  serviceProblems,
  serviceRequest,
  withDescription,
  withDuration,
  withPriceYuan,
  withSubjectCodes,
  withTitle,
  yuanToMinor,
} from './service-form';

/**
 * The provider sets their own price — the one place a client decides money
 * (`specs/01` §Services). That makes the conversion the risky part, so it is
 * tested harder than the rest of the form.
 */
describe('yuanToMinor', () => {
  it('converts whole and two-decimal yuan into integer minor units', () => {
    expect(yuanToMinor('200')).toBe(20_000);
    expect(yuanToMinor('200.5')).toBe(20_050);
    expect(yuanToMinor('200.05')).toBe(20_005);
    expect(yuanToMinor(' 0.01 ')).toBe(1);
  });

  it('refuses anything it cannot express exactly', () => {
    expect(yuanToMinor('')).toBeNull();
    expect(yuanToMinor('abc')).toBeNull();
    expect(yuanToMinor('-5')).toBeNull();
    expect(yuanToMinor('10.005')).toBeNull();
    expect(yuanToMinor('1e3')).toBeNull();
  });
});

describe('minorToYuan', () => {
  it('shows a price back the way a person typed it', () => {
    expect(minorToYuan(20_000)).toBe('200.00');
    expect(minorToYuan(20_050)).toBe('200.50');
  });
});

describe('service draft', () => {
  it('starts empty, so nothing is created by accident', () => {
    expect(newServiceDraft()).toEqual({
      title: '',
      description: '',
      durationMinutes: null,
      priceYuan: '',
      subjectCodes: [],
    });
  });

  it('records a duration only when the server would accept it', () => {
    expect(withDuration(newServiceDraft(), 60).durationMinutes).toBe(60);
    expect(withDuration(newServiceDraft(), MIN_DURATION_MINUTES).durationMinutes).toBe(
      MIN_DURATION_MINUTES,
    );
    // Too short, too long, fractional: all "not chosen yet".
    expect(withDuration(newServiceDraft(), 5).durationMinutes).toBeNull();
    expect(withDuration(newServiceDraft(), MAX_DURATION_MINUTES + 1).durationMinutes).toBeNull();
    expect(withDuration(newServiceDraft(), 45.5).durationMinutes).toBeNull();
  });

  it('cuts a title to the server’s length', () => {
    const draft = withTitle(newServiceDraft(), 'x'.repeat(500));
    expect(draft.title.length).toBe(SERVICE_TITLE_MAX);
  });

  it('cleans subject codes: trimmed, deduplicated, capped', () => {
    const draft = withSubjectCodes(newServiceDraft(), [
      ' MATH ',
      'MATH',
      'ENGLISH',
      'bad code',
      ...Array.from({ length: 40 }, (_, index) => `S${index}`),
    ]);

    expect(draft.subjectCodes[0]).toBe('MATH');
    expect(draft.subjectCodes.filter((code) => code === 'MATH').length).toBe(1);
    expect(draft.subjectCodes).not.toContain('bad code');
    expect(draft.subjectCodes.length).toBe(20);
  });
});

describe('serviceProblems', () => {
  it('asks for everything the server requires', () => {
    expect(serviceProblems(newServiceDraft())).toEqual([
      'NO_TITLE',
      'NO_DURATION',
      'NO_PRICE',
      'NO_SUBJECT',
    ]);
  });

  it('catches a price outside the platform’s bounds', () => {
    let draft = withTitle(newServiceDraft(), '数学');
    draft = withDuration(draft, 60);
    draft = withSubjectCodes(draft, ['MATH']);

    expect(serviceProblems(withPriceYuan(draft, '0.5'))).toContain('PRICE_TOO_SMALL');
    expect(serviceProblems(withPriceYuan(draft, minorToYuan(MAX_PRICE_MINOR + 100)))).toContain(
      'PRICE_TOO_LARGE',
    );
  });

  it('is satisfied by a complete form', () => {
    let draft = withTitle(newServiceDraft(), '初中数学一对一');
    draft = withDuration(draft, 90);
    draft = withPriceYuan(draft, '200');
    draft = withSubjectCodes(draft, ['MATH']);
    draft = withDescription(draft, '期末冲刺');

    expect(serviceProblems(draft)).toEqual([]);
  });
});

describe('serviceRequest', () => {
  it('sends integer minor units, never a float', () => {
    let draft = withTitle(newServiceDraft(), '初中数学一对一');
    draft = withDuration(draft, 60);
    draft = withPriceYuan(draft, '200.50');
    draft = withSubjectCodes(draft, ['MATH']);

    const body = serviceRequest(draft);
    expect(body.priceMinor).toBe(20_050);
    expect(Number.isInteger(body.priceMinor)).toBe(true);
  });

  it('omits a description that says nothing', () => {
    let draft = withTitle(newServiceDraft(), '数学');
    draft = withDuration(draft, 60);
    draft = withPriceYuan(draft, '200');
    draft = withSubjectCodes(draft, ['MATH']);
    draft = withDescription(draft, '   ');

    expect(serviceRequest(draft).description).toBeUndefined();
  });

  it('refuses an incomplete form instead of sending it', () => {
    expect(() => serviceRequest(newServiceDraft())).toThrow(ServiceInvalidError);

    try {
      serviceRequest(withTitle(newServiceDraft(), '数学'));
    } catch (error) {
      expect((error as ServiceInvalidError).problems).toContain('NO_DURATION');
    }
  });
});
