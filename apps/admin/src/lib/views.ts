import type {
  AdminAuditLogResponse,
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminUserResponse,
  AdminVerificationCaseResponse,
  PlatformRuleResponse,
  TaxonomyTermResponse,
} from '@mentor/api-contracts';

/**
 * Admin view models (T033).
 *
 * An operator screen shows what the server returned, formatted: money as yuan
 * with two decimals (never a float), times in the console's own timezone, and
 * statuses as words. Nothing is recomputed here — no GMV, no rate, no total that
 * the API did not return (`AGENTS.md` §8).
 */

export function formatMoney(minor: number, currency = '¥'): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(minor));
  const yuan = Math.floor(absolute / 100);
  const cents = absolute % 100;
  return `${sign}${currency}${yuan.toFixed(0)}.${String(cents).padStart(2, '0')}`;
}

/** ISO-8601 UTC → "2026-10-23 14:05" in the console's timezone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Basis points → "62.5%", for the conversion card of `specs/11`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export interface DashboardCard {
  label: string;
  value: string;
  hint: string;
}

/**
 * The KPI cards of `specs/11` §Admin pages.
 *
 * Only fields the API returns are shown: conversion is the funnel signal the
 * platform computes, and there is no trend series to draw (G6/G13).
 */
export function dashboardCards(counts: AdminDashboardCounts): DashboardCard[] {
  const paid = counts.orders.byStatus.PAID ?? 0;
  const pendingPayment = counts.orders.byStatus.PENDING_PAYMENT ?? 0;

  return [
    {
      label: '账号',
      value: String(counts.users.total),
      hint: `活跃 ${counts.users.active}`,
    },
    {
      label: '商家',
      value: String(counts.providers.total),
      hint: `已通过 ${counts.providers.approved} · 待审 ${counts.providers.pendingReview} · 暂停 ${counts.providers.suspended}`,
    },
    {
      label: '订单',
      value: String(counts.orders.total),
      hint: `已完成 ${counts.orders.completed} · 已支付 ${paid} · 待支付 ${pendingPayment}`,
    },
    {
      label: '成交金额',
      value: formatMoney(counts.orders.gmvMinor),
      hint: '已支付及以后的订单金额合计',
    },
    {
      label: '已退款',
      value: formatMoney(counts.refunds.totalMinor),
      hint: '实际退回客户的金额',
    },
    {
      label: '待处置举报',
      value: String(counts.moderation.openCases),
      hint: '开放中的内容审核工单',
    },
    {
      label: '支付→完成',
      value: formatBps(counts.conversion.paidToCompletedBps),
      hint: 'V1 漏斗口径（万分比）',
    },
  ];
}

export interface ProviderRow {
  id: string;
  name: string;
  typeText: string;
  approvalText: string;
  status: string;
  searchableText: string;
  createdText: string;
  /** Which commands the queue offers for this state. */
  canApprove: boolean;
  canReject: boolean;
  canSuspend: boolean;
  canRestore: boolean;
}

const APPROVAL_TEXTS: Record<string, string> = {
  DRAFT: '未提交',
  SUBMITTED: '已提交',
  UNDER_REVIEW: '审核中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  SUSPENDED: '已暂停',
};

export function providerRow(item: AdminProviderListItemResponse): ProviderRow {
  const status = item.approvalStatus;
  return {
    id: item.id,
    name: item.publicName,
    typeText: item.providerType === 'CAREER' ? '职业' : '辅导',
    approvalText: APPROVAL_TEXTS[status] ?? status,
    status,
    searchableText: item.searchable ? '可被搜索' : '未曝光',
    createdText: formatDateTime(item.createdAt),
    // The server still decides; the console only stops offering what is
    // obviously not a transition for this state.
    canApprove: status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'REJECTED',
    canReject: status === 'SUBMITTED' || status === 'UNDER_REVIEW',
    canSuspend: status === 'APPROVED',
    canRestore: status === 'SUSPENDED',
  };
}

export interface VerificationRow {
  id: string;
  providerName: string;
  typeText: string;
  statusText: string;
  status: string;
  submittedText: string;
  documentText: string;
  decidable: boolean;
}

const VERIFICATION_TYPE_TEXTS: Record<string, string> = {
  IDENTITY: '身份认证',
  EDUCATION: '学历认证',
  TEACHER_COMPLIANCE: '教师资质',
};

const VERIFICATION_STATUS_TEXTS: Record<string, string> = {
  DRAFT: '待上传材料',
  SUBMITTED: '已提交',
  UNDER_REVIEW: '审核中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  RESUBMITTED: '已重新提交',
};

export function verificationRow(item: AdminVerificationCaseResponse): VerificationRow {
  const status = item.status;
  return {
    id: item.id,
    providerName: item.providerName,
    typeText: VERIFICATION_TYPE_TEXTS[item.verificationType] ?? item.verificationType,
    statusText: VERIFICATION_STATUS_TEXTS[status] ?? status,
    status,
    submittedText: item.submittedAt ? formatDateTime(item.submittedAt) : '未提交',
    documentText: `${item.documentCount} 份材料`,
    decidable: status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'RESUBMITTED',
  };
}

export interface OrderRow {
  id: string;
  orderNo: string;
  statusText: string;
  status: string;
  amountText: string;
  createdText: string;
  payable: boolean;
}

const ORDER_STATUS_TEXTS: Record<string, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  CONFIRMED: '导师已接单',
  IN_PROGRESS: '服务中',
  COMPLETED: '已完成',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
  DISPUTED: '争议中',
};

export function orderRow(item: AdminOrderListItemResponse): OrderRow {
  const status = item.status;
  return {
    id: item.id,
    orderNo: item.orderNo,
    statusText: ORDER_STATUS_TEXTS[status] ?? status,
    status,
    amountText: formatMoney(item.amountMinor),
    createdText: formatDateTime(item.createdAt),
    // Refunds are only possible once money moved (`specs/08` §Refund).
    payable: status !== 'PENDING_PAYMENT' && status !== 'CANCELLED',
  };
}

export interface UserRow {
  id: string;
  name: string;
  statusText: string;
  roleText: string;
  roles: string[];
  createdText: string;
}

export function userRow(item: AdminUserResponse): UserRow {
  return {
    id: item.id,
    name: item.displayName,
    statusText: item.status === 'ACTIVE' ? '正常' : '已停用',
    roleText: item.roles.length > 0 ? item.roles.join('、') : '无角色',
    roles: [...item.roles],
    createdText: formatDateTime(item.createdAt),
  };
}

export interface AuditRow {
  id: string;
  actionText: string;
  actorText: string;
  resourceText: string;
  createdText: string;
}

export function auditRow(item: AdminAuditLogResponse): AuditRow {
  return {
    id: item.id,
    actionText: item.action,
    actorText: item.actorUserId ?? '系统',
    resourceText: `${item.resourceType} ${shortId(item.resourceId)}`.trim(),
    createdText: formatDateTime(item.createdAt),
  };
}

export interface TaxonomyRow {
  id: string;
  typeText: string;
  code: string;
  name: string;
  activeText: string;
  active: boolean;
}

const TAXONOMY_TYPE_TEXTS: Record<string, string> = {
  SUBJECT: '科目',
  GRADE: '年级',
  SKILL: '技能',
  CITY: '城市',
};

export function taxonomyRow(item: TaxonomyTermResponse): TaxonomyRow {
  return {
    id: item.id,
    typeText: TAXONOMY_TYPE_TEXTS[item.type] ?? item.type,
    code: item.code,
    name: item.name,
    activeText: item.active ? '启用' : '已归档',
    active: item.active,
  };
}

export interface RuleRow {
  id: string;
  typeText: string;
  statusText: string;
  status: string;
  versionText: string;
  createdText: string;
  publishable: boolean;
}

const RULE_TYPE_TEXTS: Record<string, string> = {
  PLATFORM_FEE: '平台费率',
  CANCELLATION_POLICY: '取消政策',
};

const RULE_STATUS_TEXTS: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

export function ruleRow(item: PlatformRuleResponse): RuleRow {
  return {
    id: item.id,
    typeText: RULE_TYPE_TEXTS[item.ruleType] ?? item.ruleType,
    statusText: RULE_STATUS_TEXTS[item.status] ?? item.status,
    status: item.status,
    versionText: `v${item.version}`,
    createdText: formatDateTime(item.createdAt),
    publishable: item.status === 'DRAFT',
  };
}

/** A resource id is long; the log shows enough to find it, not all of it. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
