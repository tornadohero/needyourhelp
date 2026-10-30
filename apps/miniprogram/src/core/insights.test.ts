import { describe, expect, it } from 'vitest';

import {
  buildChildProgress,
  buildCompliance,
  buildDeskHealth,
  buildPendingReviews,
  buildReputation,
  isThisWeek,
} from './insights';

describe('isThisWeek', () => {
  it('counts from Monday, and never counts the future', () => {
    const now = new Date('2026-10-30T10:00:00'); // Friday
    expect(isThisWeek(new Date('2026-10-26T09:00:00'), now)).toBe(true); // Monday
    expect(isThisWeek(new Date('2026-10-25T23:00:00'), now)).toBe(false); // Sunday
    expect(isThisWeek(new Date('2026-11-02T09:00:00'), now)).toBe(false); // next week
  });
});

describe('buildPendingReviews', () => {
  it('keeps only the lessons nobody has rated', () => {
    const list = buildPendingReviews([
      { id: 'a', title: '初中数学一对一', whenText: '今天 19:00', hasReview: false },
      { id: 'b', title: '高中英语写作精批', whenText: '昨天 20:00', hasReview: true },
    ]);

    expect(list.map((item) => item.orderId)).toEqual(['a']);
  });

  it('is empty when every lesson is rated', () => {
    const list = buildPendingReviews([{ id: 'a', title: '课', whenText: '', hasReview: true }]);
    expect(list).toHaveLength(0);
  });
});

describe('buildChildProgress', () => {
  it('counts finished lessons and names the last one', () => {
    const rows = buildChildProgress(
      [{ id: 'c1', name: '小明' }],
      [
        { childId: 'c1', status: 'COMPLETED', title: '初中数学一对一', at: '2026-10-20T10:00:00Z' },
        { childId: 'c1', status: 'COMPLETED', title: '中考数学冲刺', at: '2026-10-28T10:00:00Z' },
        { childId: 'c1', status: 'PAID', title: '未上完的课', at: '2026-10-31T10:00:00Z' },
      ],
    );

    expect(rows[0]?.lessonsDone).toBe(2);
    expect(rows[0]?.lastTitle).toBe('中考数学冲刺');
  });

  it('carries a nickname and a count only — nothing else about a child', () => {
    const rows = buildChildProgress([{ id: 'c1', name: '小红' }], []);
    expect(rows[0]).toEqual({ id: 'c1', name: '小红', lessonsDone: 0, lastTitle: '' });
  });
});

describe('buildDeskHealth', () => {
  it('names what blocks a mentor from being booked', () => {
    const health = buildDeskHealth({
      approvalText: '待审核',
      approved: false,
      searchable: false,
      publishedServices: 0,
      slotsNext7Days: 0,
    });

    expect(health.warnings).toHaveLength(3);
    expect(health.warnings[0]).toContain('审核');
  });

  it('is quiet when everything is in place', () => {
    const health = buildDeskHealth({
      approvalText: '已通过审核',
      approved: true,
      searchable: true,
      publishedServices: 2,
      slotsNext7Days: 5,
    });

    expect(health.warnings).toHaveLength(0);
    expect(health.searchableText).toBe('可被搜索');
  });
});

describe('buildReputation', () => {
  it('keeps the last two reviews that have words', () => {
    const view = buildReputation({
      ratingText: '4.9',
      reviewCount: 12,
      latest: [
        { content: '很耐心' },
        { content: null },
        { content: '讲得清楚' },
        { content: '第三' },
      ],
    });

    expect(view.latest).toEqual(['很耐心', '讲得清楚']);
  });
});

describe('buildCompliance', () => {
  it('alerts on verification that is not approved, and always on minors', () => {
    const view = buildCompliance({
      verifications: [
        { typeText: '身份认证', statusText: '已通过', approved: true },
        { typeText: '学历认证', statusText: '待提交', approved: false },
      ],
    });

    expect(view.alerts).toHaveLength(2);
    expect(view.alerts[0]).toContain('学历认证');
    expect(view.alerts[1]).toContain('未成年');
  });
});
