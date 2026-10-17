/**
 * Operations (admin) contract (T019).
 *
 * Source of truth: `specs/05-api-spec.md` §Admin, `specs/12-admin-spec.md`
 * (principles, audit list), `specs/11-pages-and-ui.md` §Admin pages.
 *
 * Everything here is admin/ops facing and minimized by role
 * (`specs/12` §Admin principles): a listing carries what an operator needs to
 * act, never the private data of the account behind it.
 */

import type { ApiRole } from './auth';
import type { ProviderApprovalStatus, ProviderTypeName } from './provider';
import type { OrderStatusName } from './orders';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `platform_rules.status`. */
export const PLATFORM_RULE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PlatformRuleStatusName = (typeof PLATFORM_RULE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface AdminDashboardCounts {
  /** Accounts that can sign in. */
  users: { total: number; active: number };
  providers: { total: number; approved: number; pendingReview: number; suspended: number };
  orders: {
    total: number;
    /** How many orders sit in each state right now. */
    byStatus: Record<OrderStatusName, number>;
    /** Sum of paid-and-beyond orders: what moved through the platform. */
    gmvMinor: number;
    completed: number;
  };
  /** Money returned to customers (`refunds` that actually moved). */
  refunds: { totalMinor: number };
  moderation: { openCases: number };
  /**
   * Completed orders over orders that were paid for, in basis points: the V1
   * funnel signal of `specs/11` §Admin pages.
   */
  conversion: { paidToCompletedBps: number };
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export interface AdminUserResponse {
  id: string;
  displayName: string;
  status: string;
  roles: ApiRole[];
  createdAt: string;
}

export interface AdminUserListResponse {
  items: AdminUserResponse[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminProviderListItemResponse {
  id: string;
  userId: string;
  publicName: string;
  providerType: ProviderTypeName;
  approvalStatus: ProviderApprovalStatus;
  searchable: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  completedOrderCount: number;
  createdAt: string;
}

export interface AdminProviderListResponse {
  items: AdminProviderListItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminOrderListItemResponse {
  id: string;
  orderNo: string;
  status: OrderStatusName;
  amountMinor: number;
  currency: string;
  buyerUserId: string;
  providerId: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdAt: string;
}

export interface AdminOrderListResponse {
  items: AdminOrderListItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAuditLogResponse {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  createdAt: string;
}

export interface AdminAuditLogListResponse {
  items: AdminAuditLogResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** The result of granting or revoking a role: always the full role list. */
export interface AdminRoleChangeResponse {
  userId: string;
  roles: ApiRole[];
}

// ---------------------------------------------------------------------------
// Platform configuration
// ---------------------------------------------------------------------------

export interface AdminFeatureFlagResponse {
  key: string;
  enabled: boolean;
  updatedAt: string;
}

export interface AdminFeatureFlagListResponse {
  items: AdminFeatureFlagResponse[];
}

export interface PlatformRuleResponse {
  id: string;
  ruleType: string;
  version: string;
  status: PlatformRuleStatusName;
  contentRef: string;
  effectiveAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface PlatformRuleListResponse {
  items: PlatformRuleResponse[];
}
