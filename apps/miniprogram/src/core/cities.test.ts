import { describe, expect, it } from 'vitest';

import { CITY_OPTIONS, cityCodeAt, cityIndexOf, cityLabels, cityName } from './cities';

describe('cityName', () => {
  it('answers the Chinese name the platform seeds', () => {
    expect(cityName('BEIJING')).toBe('北京');
    expect(cityName('SHANGHAI')).toBe('上海');
    expect(cityName('beijing')).toBe('北京');
  });

  it('says 未标注城市 when there is no code, and never hides an unknown one', () => {
    expect(cityName(null)).toBe('未标注城市');
    expect(cityName('')).toBe('未标注城市');
    // A city added later is shown as its code rather than replaced with a guess.
    expect(cityName('CHENGDU')).toBe('CHENGDU');
  });
});

describe('picker helpers', () => {
  it('pairs labels and codes by index, so the sheet and the query stay in sync', () => {
    const labels = cityLabels();
    expect(labels).toHaveLength(CITY_OPTIONS.length);
    expect(labels[1]).toBe('北京');
    expect(cityCodeAt(1)).toBe('BEIJING');
    expect(cityIndexOf('BEIJING')).toBe(1);
  });

  it('falls back to 不限 for an unknown or empty code', () => {
    expect(cityIndexOf('CHENGDU')).toBe(0);
    expect(cityIndexOf('')).toBe(0);
    expect(cityCodeAt(0)).toBe('');
    expect(cityCodeAt(99)).toBe('');
  });
});
