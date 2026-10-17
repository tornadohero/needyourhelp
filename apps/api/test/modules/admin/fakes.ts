import type {
  AdminAuditLogResponse,
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminUserResponse,
  ApiRole,
  OrderStatusName,
  ProviderApprovalStatus,
  ProviderTypeName,
} from '@mentor/api-contracts';

import type {
  AdminAuditLogQuery,
  AdminOrderQuery,
  AdminPage,
  AdminProviderQuery,
  AdminReadModel,
  AdminUserQuery,
} from '../../../src/modules/admin/domain/admin-read-model';
import type {
  CreateUserInput,
  Role,
  UpdateUserProfileInput,
  User,
  UserStatus,
} from '../../../src/modules/identity/domain/user.model';
import { USER_REPOSITORY } from '../../../src/modules/identity/domain/user.repository';
import type { UserRepository } from '../../../src/modules/identity/domain/user.repository';

/** In-memory {@link AdminReadModel}: everything an operations page reads. */
export class FakeAdminReadModel implements AdminReadModel {
  readonly users: AdminUserResponse[] = [];
  readonly providers: AdminProviderListItemResponse[] = [];
  readonly orders: AdminOrderListItemResponse[] = [];
  readonly auditLogs: AdminAuditLogResponse[] = [];
  dashboardCounts: AdminDashboardCounts = emptyDashboard();

  adminCount = 0;

  async dashboard(): Promise<AdminDashboardCounts> {
    return this.dashboardCounts;
  }

  async countAdmins(): Promise<number> {
    return this.adminCount;
  }

  async listUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserResponse>> {
    const matching = this.users.filter(
      (user) =>
        (!query.status || user.status === query.status) &&
        (!query.search || user.displayName.includes(query.search)),
    );
    return { items: matching.slice(query.skip, query.skip + query.take), total: matching.length };
  }

  async listProviders(
    query: AdminProviderQuery,
  ): Promise<AdminPage<AdminProviderListItemResponse>> {
    const matching = this.providers.filter(
      (provider) => !query.approvalStatus || provider.approvalStatus === query.approvalStatus,
    );
    return { items: matching.slice(query.skip, query.skip + query.take), total: matching.length };
  }

  async listOrders(query: AdminOrderQuery): Promise<AdminPage<AdminOrderListItemResponse>> {
    const matching = this.orders.filter((order) => !query.status || order.status === query.status);
    return { items: matching.slice(query.skip, query.skip + query.take), total: matching.length };
  }

  async listAuditLogs(query: AdminAuditLogQuery): Promise<AdminPage<AdminAuditLogResponse>> {
    const matching = this.auditLogs.filter(
      (row) =>
        (!query.actorUserId || row.actorUserId === query.actorUserId) &&
        (!query.action || row.action === query.action) &&
        (!query.resourceType || row.resourceType === query.resourceType),
    );
    return { items: matching.slice(query.skip, query.skip + query.take), total: matching.length };
  }

  addUser(user: Partial<AdminUserResponse> & { id: string }): void {
    this.users.push({
      displayName: '用户',
      status: 'ACTIVE',
      roles: ['USER'],
      createdAt: new Date().toISOString(),
      ...user,
    });
  }

  addProvider(provider: Partial<AdminProviderListItemResponse> & { id: string }): void {
    this.providers.push({
      userId: 'user-1',
      publicName: '李老师',
      providerType: 'TUTORING' as ProviderTypeName,
      approvalStatus: 'APPROVED' as ProviderApprovalStatus,
      searchable: true,
      ratingAvg: null,
      ratingCount: 0,
      completedOrderCount: 0,
      createdAt: new Date().toISOString(),
      ...provider,
    });
  }

  addOrder(order: Partial<AdminOrderListItemResponse> & { id: string }): void {
    this.orders.push({
      orderNo: 'MO-1',
      status: 'PAID' as OrderStatusName,
      amountMinor: 20_000,
      currency: 'CNY',
      buyerUserId: 'buyer-1',
      providerId: 'provider-1',
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: new Date().toISOString(),
      ...order,
    });
  }

  addAuditLog(row: Partial<AdminAuditLogResponse> & { id: string }): void {
    this.auditLogs.push({
      actorUserId: 'admin-1',
      actorType: 'ADMIN',
      action: 'PROVIDER_APPROVED',
      resourceType: 'provider_profile',
      resourceId: 'provider-1',
      requestId: 'req-1',
      createdAt: new Date().toISOString(),
      ...row,
    });
  }
}

export function emptyDashboard(): AdminDashboardCounts {
  return {
    users: { total: 0, active: 0 },
    providers: { total: 0, approved: 0, pendingReview: 0, suspended: 0 },
    orders: {
      total: 0,
      byStatus: {
        PENDING_PAYMENT: 0,
        PAID: 0,
        CONFIRMED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        REFUND_PENDING: 0,
        REFUNDED: 0,
        CANCELLED: 0,
        DISPUTED: 0,
      },
      gmvMinor: 0,
      completed: 0,
    },
    refunds: { totalMinor: 0 },
    moderation: { openCases: 0 },
    conversion: { paidToCompletedBps: 0 },
  };
}

/** In-memory {@link UserRepository} that also tracks role changes. */
export class FakeAdminUserRepository implements UserRepository {
  readonly roles = new Map<string, Role[]>();
  readonly known = new Set<string>();

  async findById(id: string) {
    if (!this.known.has(id)) {
      return null;
    }
    return {
      id,
      status: 'ACTIVE' as UserStatus,
      wechatOpenidHash: null,
      unionidHash: null,
      displayName: '用户',
      avatarUrl: null,
      phoneEncrypted: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async findByWechatOpenidHash() {
    return null;
  }

  async create(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in admin tests');
  }

  async createWithRoles(_input: CreateUserInput, _roles: Role[]): Promise<User> {
    throw new Error('not used in admin tests');
  }

  async updateProfile(_userId: string, _input: UpdateUserProfileInput): Promise<User> {
    throw new Error('not used in admin tests');
  }

  async addRole(userId: string, role: Role): Promise<void> {
    const current = this.roles.get(userId) ?? [];
    if (!current.includes(role)) {
      this.roles.set(userId, [...current, role]);
    }
  }

  async removeRole(userId: string, role: Role): Promise<void> {
    this.roles.set(
      userId,
      (this.roles.get(userId) ?? []).filter((entry) => entry !== role),
    );
  }

  async listRoles(userId: string): Promise<Role[]> {
    return [...(this.roles.get(userId) ?? [])];
  }

  async setStatus() {
    return undefined;
  }
}

export { USER_REPOSITORY };
export type { ApiRole };
