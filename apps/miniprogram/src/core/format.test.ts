import { describe, expect, it } from 'vitest';

import { formatAmount, formatDate, formatDateTime, formatDuration, formatMoney } from './format';

describe('formatMoney', () => {
  it('formats minor units the server decided, without float maths', () => {
    expect(formatMoney(20_000)).toBe('¥200.00');
    expect(formatMoney(0)).toBe('¥0.00');
    expect(formatMoney(5)).toBe('¥0.05');
    expect(formatMoney(123_456)).toBe('¥1234.56');
    expect(formatMoney(-20_000)).toBe('-¥200.00');
  });

  it('formats an amount without a currency symbol', () => {
    expect(formatAmount(20_000)).toBe('200.00');
  });
});

describe('formatDateTime', () => {
  it('renders an ISO timestamp in the device timezone', () => {
    const rendered = formatDateTime('2026-10-20T03:51:24.231Z');
    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('renders nothing for a value that is not a date', () => {
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('formatDate', () => {
  it('renders the date only', () => {
    expect(formatDate('2026-10-20T03:51:24.231Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDuration', () => {
  it('renders minutes and hours the way a booking screen needs', () => {
    expect(formatDuration(45)).toBe('45 分钟');
    expect(formatDuration(60)).toBe('1 小时');
    expect(formatDuration(90)).toBe('1 小时 30 分钟');
  });
});
