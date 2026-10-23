import type {
  AvailabilitySlotResponse,
  OrderResponse,
  ProviderProfileResponse,
  ServiceResponse,
  VerificationCaseResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  ApplicationInvalidError,
  applicationProblems,
  applicationRequest,
  describeCapability,
  describeProviderDesk,
  describeProviderOrder,
  describeServiceRow,
  describeSlotRow,
  describeVerificationCase,
  providerNextAction,
  providerOrdersOnly,
} from './provider-desk';

function profile(overrides: Partial<ProviderProfileResponse> = {}): ProviderProfileResponse {
  return {
    id: 'provider-1',
    userId: 'user-1',
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: '初中数学',
    bio: null,
    avatarVisibility: 'PUBLIC',
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    approvalStatus: 'APPROVED',
    searchable: true,
    ratingAvg: 4.5,
    ratingCount: 3,
    completedOrderCount: 7,
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function service(overrides: Partial<ServiceResponse> = {}): ServiceResponse {
  return {
    id: 'service-1',
    providerId: 'provider-1',
    domain: 'TUTORING',
    title: '初中数学一对一',
    description: null,
    durationMinutes: 60,
    priceMinor: 20_000,
    currency: 'CNY',
    deliveryMode: 'ONLINE',
    status: 'DRAFT',
    terms: [{ termId: 'term-1', type: 'SUBJECT', code: 'MATH', name: '数学' }],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function slot(overrides: Partial<AvailabilitySlotResponse> = {}): AvailabilitySlotResponse {
  return {
    id: 'slot-1',
    providerId: 'provider-1',
    startAt: '2026-11-01T02:00:00.000Z',
    endAt: '2026-11-01T03:00:00.000Z',
    recurrenceRule: null,
    status: 'OPEN',
    ...overrides,
  };
}

function verificationCase(
  overrides: Partial<VerificationCaseResponse> = {},
): VerificationCaseResponse {
  return {
    id: 'case-1',
    providerId: 'provider-1',
    verificationType: 'IDENTITY',
    status: 'UNDER_REVIEW',
    submittedAt: '2026-10-02T00:00:00.000Z',
    reviewedAt: null,
    decisionReason: null,
    documents: [
      {
        id: 'doc-1',
        documentType: 'ID_CARD',
        createdAt: '2026-10-02T00:00:00.000Z',
        expiresAt: null,
      },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 'order-1',
    orderNo: 'MP202610210001',
    buyerUserId: 'user-9',
    providerId: 'provider-1',
    serviceId: 'service-1',
    childId: null,
    domain: 'TUTORING',
    status: 'PAID',
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: '2026-11-01T02:00:00.000Z',
    scheduledEnd: '2026-11-01T03:00:00.000Z',
    priceSnapshot: {
      serviceId: 'service-1',
      title: '初中数学一对一',
      priceMinor: 20_000,
      currency: 'CNY',
      durationMinutes: 60,
    },
    createdAt: '2026-10-21T02:00:00.000Z',
    updatedAt: '2026-10-21T02:00:00.000Z',
    ...overrides,
  };
}

describe('describeProviderDesk', () => {
  it('shows what the public payload hides, because it is the provider’s own record', () => {
    const desk = describeProviderDesk(profile({ approvalStatus: 'SUBMITTED', searchable: false }));

    expect(desk.approvalText).toBe('已提交');
    expect(desk.searchableText).toBe('暂未出现在发现页');
  });

  it('offers publishing only once approval is there', () => {
    expect(describeProviderDesk(profile({ approvalStatus: 'APPROVED' })).canPublish).toBe(true);
    expect(describeProviderDesk(profile({ approvalStatus: 'UNDER_REVIEW' })).canPublish).toBe(
      false,
    );
    expect(describeProviderDesk(profile({ approvalStatus: 'SUSPENDED' })).canPublish).toBe(false);
  });

  it('offers submitting only for a record a reviewer has not accepted', () => {
    expect(describeProviderDesk(profile({ approvalStatus: 'DRAFT' })).canSubmit).toBe(true);
    expect(describeProviderDesk(profile({ approvalStatus: 'REJECTED' })).canSubmit).toBe(true);
    expect(describeProviderDesk(profile({ approvalStatus: 'APPROVED' })).canSubmit).toBe(false);
  });
});

describe('describeCapability', () => {
  it('names the tutoring identity, its approval, verification and compliance', () => {
    const view = describeCapability({
      id: 'cap-1',
      capabilityType: 'TEACHER',
      status: 'APPROVED',
      verificationLevel: 'FULL',
      complianceStatus: 'PENDING',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(view.typeText).toBe('在职教师');
    expect(view.statusText).toBe('已通过');
    expect(view.verificationText).toBe('身份与学历均已验证');
    expect(view.complianceText).toBe('待提交');
  });
});

describe('describeServiceRow', () => {
  it('shows the state and what the owner can do with it', () => {
    expect(describeServiceRow(service({ status: 'DRAFT' }))).toMatchObject({
      statusText: '草稿',
      canPublish: true,
      canUnpublish: false,
    });
    expect(describeServiceRow(service({ status: 'PUBLISHED' }))).toMatchObject({
      statusText: '已发布',
      canPublish: false,
      canUnpublish: true,
    });
  });

  it('names the subjects the compliance check compares against', () => {
    expect(describeServiceRow(service()).termText).toBe('数学');
  });

  it('formats the provider’s own price without recomputing it', () => {
    expect(describeServiceRow(service({ priceMinor: 20_000 })).priceText).toBe('¥200.00');
  });
});

describe('describeSlotRow', () => {
  it('withdraws only a window nobody has booked', () => {
    expect(describeSlotRow(slot({ status: 'OPEN' })).deletable).toBe(true);
    // A booked window belongs to an order now (T011).
    expect(describeSlotRow(slot({ status: 'BOOKED' })).deletable).toBe(false);
  });
});

describe('describeVerificationCase', () => {
  it('shows the provider’s own case without a document body', () => {
    const view = describeVerificationCase(verificationCase());

    expect(view.typeText).toBe('身份认证');
    expect(view.statusText).toBe('审核中');
    expect(view.documentText).toBe('1 份材料');
    // A document is metadata here: no key, no URL, no image.
    expect(JSON.stringify(view)).not.toContain('ID_CARD');
  });
});

describe('providerNextAction', () => {
  it('walks the three provider commands and nothing else', () => {
    expect(providerNextAction('PAID')).toBe('confirm');
    expect(providerNextAction('CONFIRMED')).toBe('start');
    expect(providerNextAction('IN_PROGRESS')).toBe('complete');
  });

  it('has nothing to offer before payment or after the end', () => {
    expect(providerNextAction('PENDING_PAYMENT')).toBeNull();
    expect(providerNextAction('COMPLETED')).toBeNull();
    expect(providerNextAction('CANCELLED')).toBeNull();
  });
});

describe('providerOrdersOnly', () => {
  it('keeps the orders this provider delivers, and only those', () => {
    const mine = describeProviderOrder(order({ id: 'mine', providerId: 'provider-1' }));
    const theirs = describeProviderOrder(order({ id: 'theirs', providerId: 'provider-2' }));

    expect(providerOrdersOnly([mine, theirs], 'provider-1').map((row) => row.id)).toEqual(['mine']);
  });

  it('labels the one command each row can run', () => {
    expect(describeProviderOrder(order({ status: 'PAID' })).actionText).toBe('接单');
    expect(describeProviderOrder(order({ status: 'CONFIRMED' })).actionText).toBe('开始服务');
    expect(describeProviderOrder(order({ status: 'IN_PROGRESS' })).actionText).toBe('完成服务');
    expect(describeProviderOrder(order({ status: 'COMPLETED' })).actionText).toBe('');
  });
});

describe('applicationRequest', () => {
  it('sends display fields and claimed identities, and nothing the server decides', () => {
    const body = applicationRequest({
      publicName: ' 李老师 ',
      headline: '初中数学',
      capabilityTypes: ['TEACHER'],
    });

    expect(body).toEqual({
      publicName: '李老师',
      headline: '初中数学',
      capabilityTypes: ['TEACHER'],
    });

    const serialised = JSON.stringify(body);
    for (const forbidden of ['approvalStatus', 'searchable', 'userId', 'roles', 'rating']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('drops optional fields that say nothing', () => {
    const body = applicationRequest({
      publicName: '李老师',
      bio: '   ',
      capabilityTypes: ['TEACHER'],
    });
    expect(body.bio).toBeUndefined();
  });

  it('refuses an application with no name or no identity', () => {
    expect(applicationProblems({ publicName: '  ', capabilityTypes: ['TEACHER'] })).toEqual([
      'NO_PUBLIC_NAME',
    ]);
    expect(applicationProblems({ publicName: '李老师', capabilityTypes: [] })).toEqual([
      'NO_CAPABILITY',
    ]);
    expect(() => applicationRequest({ publicName: '', capabilityTypes: [] })).toThrow(
      ApplicationInvalidError,
    );
  });

  it('refuses a city code the server would refuse', () => {
    expect(
      applicationProblems({ publicName: '李老师', cityCode: '北京', capabilityTypes: ['TEACHER'] }),
    ).toEqual(['BAD_CITY']);
  });
});
