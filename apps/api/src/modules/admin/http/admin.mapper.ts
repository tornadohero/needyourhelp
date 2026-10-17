import type {
  AdminAuditLogResponse,
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminRoleChangeResponse,
  AdminUserResponse,
} from '@mentor/api-contracts';

/**
 * The operations read model is already shaped as a response
 * (`AGENTS.md` §10: responses are built field by field, never serialized ORM
 * entities), so these mappers only add the paging that produced the page.
 */

export function toAdminUserListResponse(result: {
  items: AdminUserResponse[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return result;
}

export function toAdminProviderListResponse(result: {
  items: AdminProviderListItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return result;
}

export function toAdminOrderListResponse(result: {
  items: AdminOrderListItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return result;
}

export function toAdminAuditLogListResponse(result: {
  items: AdminAuditLogResponse[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return result;
}

export function toAdminDashboardResponse(dashboard: AdminDashboardCounts) {
  return dashboard;
}

export function toAdminRoleChangeResponse(result: AdminRoleChangeResponse) {
  return result;
}
