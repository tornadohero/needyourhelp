import type {
  AvailabilitySlotResponse,
  ProviderDetailResponse,
  ProviderSearchItemResponse,
  ReviewResponse,
  ServiceResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  describeProviderDetail,
  describeReview,
  describeSearchItem,
  describeService,
  describeSlot,
} from './provider-view';

function item(overrides: Partial<ProviderSearchItemResponse> = {}): ProviderSearchItemResponse {
  return {
    id: 'provider-1',
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: '数学一对一',
    bio: null,
    avatarAssetId: null,
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    ratingAvg: 4.5,
    ratingCount: 12,
    completedOrderCount: 30,
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    minPriceMinor: 20_000,
    ...overrides,
  };
}

function service(overrides: Partial<ServiceResponse> = {}): ServiceResponse {
  return {
    id: 'service-1',
    providerId: 'provider-1',
    domain: 'TUTORING',
    title: '数学一对一',
    description: null,
    durationMinutes: 90,
    priceMinor: 20_000,
    currency: 'CNY',
    deliveryMode: 'ONLINE',
    status: 'PUBLISHED',
    terms: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('describeSearchItem', () => {
  it('renders the public fields and the price the server calculated', () => {
    expect(describeSearchItem(item())).toMatchObject({
      name: '李老师',
      cityText: 'BEIJING',
      ratingText: '4.5 分 · 12 条',
      completedText: '30 次完成',
      fromPriceText: '¥200.00 起',
    });
  });

  it('never invents a rating or a price', () => {
    const view = describeSearchItem(item({ ratingAvg: null, ratingCount: 0, minPriceMinor: null }));
    expect(view.ratingText).toBe('暂无评价');
    expect(view.fromPriceText).toBe('暂无在售服务');
  });
});

describe('describeService', () => {
  it('formats duration and money the way a money screen must', () => {
    expect(describeService(service())).toMatchObject({
      title: '数学一对一',
      durationText: '1 小时 30 分钟',
      priceText: '¥200.00',
    });
  });
});

describe('describeProviderDetail', () => {
  it('carries the published services only', () => {
    const detail: ProviderDetailResponse = { ...item(), services: [service()] };
    const view = describeProviderDetail(detail);

    expect(view.serviceCount).toBe(1);
    expect(view.services[0]?.priceText).toBe('¥200.00');
  });

  it('answers an empty service list without inventing one', () => {
    const view = describeProviderDetail({ ...item(), services: [] });
    expect(view.services).toEqual([]);
    expect(view.serviceCount).toBe(0);
  });
});

describe('describeReview', () => {
  it('shows the content, and nothing in place of a hidden one', () => {
    const review: ReviewResponse = {
      id: 'review-1',
      orderId: 'order-1',
      reviewerUserId: 'user-1',
      revieweeUserId: 'user-2',
      rating: 5,
      content: '讲得很清楚',
      status: 'PUBLISHED',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };

    expect(describeReview(review).content).toBe('讲得很清楚');
    // A hidden review has `content: null` server-side; no placeholder is invented.
    expect(describeReview({ ...review, content: null }).content).toBe('');
  });
});

describe('describeSlot', () => {
  it('renders a bookable window in the device timezone', () => {
    const slot: AvailabilitySlotResponse = {
      id: 'slot-1',
      providerId: 'provider-1',
      startAt: '2026-03-01T02:00:00.000Z',
      endAt: '2026-03-01T03:00:00.000Z',
      recurrenceRule: null,
      status: 'OPEN',
    };

    expect(describeSlot(slot).rangeText).toMatch(/–/);
  });
});
