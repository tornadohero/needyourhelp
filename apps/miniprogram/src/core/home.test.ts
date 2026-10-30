import { describe, expect, it } from 'vitest';

import { buildToDo, buildToday, isPending, isSameDay, isUrgent, whenText } from './home';
import type { HomeOrderLike } from './home';

const NOW = new Date('2026-10-30T10:00:00');

function order(overrides: Partial<HomeOrderLike>): HomeOrderLike {
  return {
    id: 'order-1',
    status: 'PAID',
    statusText: '已支付',
    title: '初中数学一对一',
    timeText: '',
    scheduledStart: '2026-10-31T02:00:00Z',
    providerId: 'provider-1',
    ...overrides,
  };
}

describe('whenText', () => {
  it('answers 今天 / 明天 / a date, the way a person asks', () => {
    expect(whenText('2026-10-30T11:30:00', NOW)).toBe('今天 11:30');
    expect(whenText('2026-10-31T02:00:00', NOW)).toBe('明天 02:00');
    expect(whenText('2026-11-05T02:00:00', NOW)).toBe('11月5日 02:00');
  });

  it('answers nothing when the order has no time', () => {
    expect(whenText(null, NOW)).toBe('');
    expect(whenText('not-a-date', NOW)).toBe('');
  });
});

describe('isUrgent', () => {
  it('is true within a day, and once the time has passed', () => {
    expect(isUrgent('2026-10-30T20:00:00', NOW)).toBe(true);
    expect(isUrgent('2026-10-29T02:00:00', NOW)).toBe(true);
    expect(isUrgent('2026-11-02T02:00:00', NOW)).toBe(false);
  });
});

describe('isSameDay', () => {
  it('compares calendar days, not hours', () => {
    expect(isSameDay(new Date('2026-10-30T23:59:00'), new Date('2026-10-30T00:01:00'))).toBe(true);
    expect(isSameDay(new Date('2026-10-30T23:59:00'), new Date('2026-10-31T00:01:00'))).toBe(false);
  });
});

describe('buildToDo (parent)', () => {
  it('asks for payment first, then patience', () => {
    const list = buildToDo(
      [order({ id: 'a', status: 'PENDING_PAYMENT' }), order({ id: 'b', status: 'PAID' })],
      'parent',
      NOW,
    );

    expect(list).toHaveLength(2);
    expect(list[0]?.action).toBe('pay');
    expect(list[0]?.actionText).toBe('去支付');
    expect(list[1]?.action).toBe('wait');
  });

  it('leaves finished money states off a to-do list', () => {
    const list = buildToDo(
      [
        order({ id: 'a', status: 'COMPLETED' }),
        order({ id: 'b', status: 'CANCELLED' }),
        order({ id: 'c', status: 'REFUND_PENDING' }),
      ],
      'parent',
      NOW,
    );

    expect(list).toHaveLength(0);
    expect(isPending('COMPLETED')).toBe(false);
  });

  it('puts the lesson that is about to happen first', () => {
    const list = buildToDo(
      [
        order({ id: 'later', status: 'CONFIRMED', scheduledStart: '2026-11-09T02:00:00Z' }),
        order({ id: 'soon', status: 'CONFIRMED', scheduledStart: '2026-10-30T12:00:00' }),
      ],
      'parent',
      NOW,
    );

    expect(list[0]?.orderId).toBe('soon');
    expect(list[0]?.urgent).toBe(true);
  });
});

describe('buildToDo (provider)', () => {
  it('maps the three commands the server owns', () => {
    const list = buildToDo(
      [
        order({ id: 'a', status: 'PAID' }),
        order({ id: 'b', status: 'CONFIRMED' }),
        order({ id: 'c', status: 'IN_PROGRESS' }),
      ],
      'provider',
      NOW,
    );

    expect(list.map((item) => item.action)).toEqual(['confirm', 'start', 'complete']);
  });

  it('never offers a status write: only commands', () => {
    const list = buildToDo([order({ status: 'PAID' })], 'provider', NOW);
    expect(list[0]?.action).not.toBe('view');
    expect(list[0]?.hint).toContain('接单');
  });
});

describe('buildToday', () => {
  it('answers what the mentor teaches today', () => {
    const today = buildToday(
      [
        order({ id: 'today', scheduledStart: '2026-10-30T12:00:00' }),
        order({ id: 'tomorrow', scheduledStart: '2026-10-31T12:00:00' }),
        order({ id: 'none', scheduledStart: null }),
      ],
      NOW,
    );

    expect(today).toHaveLength(1);
    expect(today[0]?.orderId).toBe('today');
  });
});
