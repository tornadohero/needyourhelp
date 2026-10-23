import type {
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminUserResponse,
  AdminVerificationCaseResponse,
  AdminAuditLogResponse,
  PlatformRuleResponse,
  TaxonomyTermResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  auditRow,
  dashboardCards,
  formatBps,
  formatMoney,
  orderRow,
  providerRow,
  ruleRow,
  taxonomyRow,
  userRow,
  verificationRow,
} from './views';

function counts(): AdminDashboardCounts {
  return {
    users: { total: 12, active: 10 },
    providers: { total: 5, approved: 3, pendingReview: 1, suspended: 1 },
    orders: {
      total: 40,
      byStatus: {
        PENDING_PAYMENT: 4,
        PAID: 6,
        CONFIRMED: 5,
        IN_PROGRESS: 3,
        COMPLETED: 20,
        REFUND_PENDING: 1,
        REFUNDED: 1,
        CANCELLED: 0,
        DISPUTED: 0,
      },
      gmvMinor: 1_234_500,
      completed: 20,
    },
    refunds: { totalMinor: 20_000 },
    moderation: { openCases: 2 },
    conversion: { paidToCompletedBps: 5_000 },
  };
}

describe('formatting', () => {
  it('shows money the server decided, in yuan with two decimals', () => {
    expect(formatMoney(20_000)).toBe('¥200.00');
    expect(formatMoney(20_005)).toBe('¥200.05');
    expect(formatMoney(100)).toBe('¥1.00');
  });

  it('shows basis points as a percentage', () => {
    expect(formatBps(5_000)).toBe('50.0%');
    expect(formatBps(625)).toBe('6.3%');
  });
});

describe('dashboardCards', () => {
  it('covers every KPI block of specs/11 §Admin pages', () => {
    const labels = dashboardCards(counts()).map((card) => card.label);

    expect(labels).toEqual([
      '账号',
      '商家',
      '订单',
      '成交金额',
      '已退款',
      '待处置举报',
      '支付→完成',
    ]);
  });

  it('renders the numbers the API returned and nothing invented', () => {
    const cards = dashboardCards(counts());

    expect(cards[3]?.value).toBe('¥12345.00');
    expect(cards[6]?.value).toBe('50.0%');
  });
});

describe('providerRow', () => {
  function provider(
    overrides: Partial<AdminProviderListItemResponse> = {},
  ): AdminProviderListItemResponse {
    return {
      id: 'provider-1',
      userId: 'user-1',
      publicName: '李老师',
      providerType: 'TUTORING',
      approvalStatus: 'SUBMITTED',
      searchable: false,
      ratingAvg: null,
      ratingCount: 0,
      completedOrderCount: 0,
      createdAt: '2026-10-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('offers only the transitions the state allows, and always asks for a reason', () => {
    expect(providerRow(provider({ approvalStatus: 'SUBMITTED' }))).toMatchObject({
      approvalText: '已提交',
      canApprove: true,
      canReject: true,
      canSuspend: false,
      canRestore: false,
    });

    expect(providerRow(provider({ approvalStatus: 'APPROVED' }))).toMatchObject({
      canApprove: false,
      canSuspend: true,
    });

    expect(providerRow(provider({ approvalStatus: 'SUSPENDED' }))).toMatchObject({
      canSuspend: false,
      canRestore: true,
    });
  });

  it('says whether the merchant is exposed, because that is server-owned', () => {
    expect(providerRow(provider({ searchable: true })).searchableText).toBe('可被搜索');
    expect(providerRow(provider({ searchable: false })).searchableText).toBe('未曝光');
  });
});

describe('verificationRow', () => {
  function verificationCase(): AdminVerificationCaseResponse {
    return {
      id: 'case-1',
      providerId: 'provider-1',
      providerName: '李老师',
      verificationType: 'IDENTITY',
      status: 'UNDER_REVIEW',
      documentCount: 2,
      submittedAt: '2026-10-02T00:00:00.000Z',
      reviewedAt: null,
      decisionReason: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
  }

  it('names the type and the state, and says how much evidence there is', () => {
    const row = verificationRow(verificationCase());

    expect(row.typeText).toBe('身份认证');
    expect(row.statusText).toBe('审核中');
    expect(row.documentText).toBe('2 份材料');
    expect(row.decidable).toBe(true);
  });

  it('stops offering a decision once the case is decided', () => {
    expect(verificationRow({ ...verificationCase(), status: 'APPROVED' }).decidable).toBe(false);
  });
});

describe('orderRow', () => {
  function order(overrides: Partial<AdminOrderListItemResponse> = {}): AdminOrderListItemResponse {
    return {
      id: 'order-1',
      orderNo: 'MP202610230001',
      status: 'PAID',
      amountMinor: 20_000,
      currency: 'CNY',
      buyerUserId: 'user-1',
      providerId: 'provider-1',
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: '2026-10-23T00:00:00.000Z',
      ...overrides,
    };
  }

  it('offers a refund only once money has moved', () => {
    expect(orderRow(order({ status: 'PAID' })).payable).toBe(true);
    expect(orderRow(order({ status: 'PENDING_PAYMENT' })).payable).toBe(false);
    expect(orderRow(order({ status: 'CANCELLED' })).payable).toBe(false);
  });

  it('shows the order number and the amount the server recorded', () => {
    const row = orderRow(order());

    expect(row.orderNo).toBe('MP202610230001');
    expect(row.amountText).toBe('¥200.00');
    expect(row.statusText).toBe('已支付');
  });
});

describe('userRow, auditRow, taxonomyRow, ruleRow', () => {
  it('lists the roles the server holds, never a client guess', () => {
    const user: AdminUserResponse = {
      id: 'user-1',
      displayName: '运营小王',
      status: 'ACTIVE',
      roles: ['ADMIN', 'OPS'],
      createdAt: '2026-10-01T00:00:00.000Z',
    };

    expect(userRow(user)).toMatchObject({ roleText: 'ADMIN、OPS', statusText: '正常' });
  });

  it('shortens a resource id in the log but keeps enough to find it', () => {
    const log: AdminAuditLogResponse = {
      id: 'audit-1',
      actorUserId: 'user-1',
      actorType: 'USER',
      action: 'PROVIDER_APPROVED',
      resourceType: 'provider',
      resourceId: '3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708',
      requestId: 'req-1',
      createdAt: '2026-10-23T00:00:00.000Z',
    };

    expect(auditRow(log).resourceText).toBe('provider 3f2a1b4c…');
  });

  it('shows an archived term as archived, never deleted', () => {
    const term: TaxonomyTermResponse = {
      id: 'term-1',
      type: 'SUBJECT',
      code: 'MATH',
      name: '数学',
      parentId: null,
      active: false,
    };

    expect(taxonomyRow(term)).toMatchObject({ activeText: '已归档', typeText: '科目' });
  });

  it('offers publishing only for a draft rule', () => {
    const rule: PlatformRuleResponse = {
      id: 'rule-1',
      ruleType: 'PLATFORM_FEE',
      version: '1',
      status: 'DRAFT',
      contentRef: 'platform-fee-v1',
      effectiveAt: null,
      publishedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    };

    expect(ruleRow(rule).publishable).toBe(true);
    expect(ruleRow({ ...rule, status: 'PUBLISHED' }).publishable).toBe(false);
    expect(ruleRow(rule).versionText).toBe('v1');
  });
});
