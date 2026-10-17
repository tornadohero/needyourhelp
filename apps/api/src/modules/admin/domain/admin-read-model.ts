import type {
  AdminAuditLogResponse,
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminUserResponse,
  OrderStatusName,
  ProviderApprovalStatus,
} from '@mentor/api-contracts';

/** Dependency-injection token for {@link AdminReadModel}. */
export const ADMIN_READ_MODEL = 'ADMIN_READ_MODEL';

export interface AdminUserQuery {
  status?: string | null;
  /** Free text on the display name; matched case-insensitively. */
  search?: string | null;
  skip: number;
  take: number;
}

export interface AdminProviderQuery {
  approvalStatus?: ProviderApprovalStatus | null;
  skip: number;
  take: number;
}

export interface AdminOrderQuery {
  status?: OrderStatusName | null;
  skip: number;
  take: number;
}

export interface AdminAuditLogQuery {
  actorUserId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  skip: number;
  take: number;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
}

/**
 * Read-only operations view (`specs/12-admin-spec.md` §Admin principles:
 * "Search results are minimized by role").
 *
 * Like the discovery directory of T010, this is a read model of another
 * context's state: it never writes, never decides, and never duplicates a gate.
 * It exists so the operations pages can search, filter and page without every
 * context growing an admin query of its own.
 */
export interface AdminReadModel {
  /** `GET /admin/dashboard`. */
  dashboard(): Promise<AdminDashboardCounts>;

  /** How many accounts hold `ADMIN`: the bootstrap may only run at zero. */
  countAdmins(): Promise<number>;

  listUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserResponse>>;

  listProviders(query: AdminProviderQuery): Promise<AdminPage<AdminProviderListItemResponse>>;

  listOrders(query: AdminOrderQuery): Promise<AdminPage<AdminOrderListItemResponse>>;

  listAuditLogs(query: AdminAuditLogQuery): Promise<AdminPage<AdminAuditLogResponse>>;
}
