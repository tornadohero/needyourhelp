import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminAuditLogListResponse,
  AdminDashboardCounts,
  AdminOrderListResponse,
  AdminProviderListResponse,
  AdminRoleChangeResponse,
  AdminUserListResponse,
  ApiRole,
} from '@mentor/api-contracts';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { ADMIN_READ_MODEL } from '../domain/admin-read-model';
import type {
  AdminAuditLogQuery,
  AdminOrderQuery,
  AdminProviderQuery,
  AdminReadModel,
} from '../domain/admin-read-model';
import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import { assertPage, assertPageSize, assertRole } from '../domain/admin-policy';
import { adminForbidden, adminNotFound } from '../domain/admin.errors';

export interface AdminActor {
  actorUserId: string;
  requestId: string;
  ipHash?: string | null;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
}

/** The roles an operator may hand out (`specs/07-permission-spec.md`). */
export const ASSIGNABLE_ROLES: readonly ApiRole[] = [
  'USER',
  'PARENT',
  'STUDENT',
  'PROVIDER',
  'ADMIN',
  'OPS',
  'FINANCE',
  'MODERATOR',
];

/**
 * Operations commands and views (`specs/05-api-spec.md` §Admin,
 * `specs/12-admin-spec.md`).
 *
 * Two rules shape this service: a listing is minimized by role — an operator
 * sees what they need to act and nothing private — and **a role change is
 * audited**, because it is the one mutation here that grants power.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(ADMIN_READ_MODEL) private readonly readModel: AdminReadModel,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private get environment(): string {
    return this.config.get<string>('NODE_ENV') ?? 'local';
  }

  /** `GET /admin/dashboard`. */
  async dashboard(): Promise<AdminDashboardCounts> {
    return this.readModel.dashboard();
  }

  /**
   * `POST /admin/bootstrap`: the first administrator, and only the first.
   *
   * Without it, starting the platform would need a direct database edit to
   * create an admin — which is what T019 removes. It closes itself: once any
   * account holds `ADMIN` it refuses, and it only exists where the mock login
   * adapter is allowed, so a production deployment never exposes it.
   */
  async bootstrapAdmin(actor: AdminActor): Promise<AdminRoleChangeResponse> {
    if (!isMockAdapterAllowed(this.environment)) {
      throw adminForbidden('Administrator bootstrap is only available in a dev/test deployment.');
    }
    if ((await this.readModel.countAdmins()) > 0) {
      throw adminForbidden('An administrator already exists.');
    }

    const before = await this.users.listRoles(actor.actorUserId);
    await this.users.addRole(actor.actorUserId, 'ADMIN');
    const after = await this.users.listRoles(actor.actorUserId);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.roleGranted,
      resourceType: 'user_role',
      resourceId: actor.actorUserId,
      beforeJson: { roles: before },
      afterJson: { roles: after, granted: 'ADMIN', bootstrap: true },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { userId: actor.actorUserId, roles: after as ApiRole[] };
  }

  /** `GET /admin/users`. */
  async listUsers(
    query: ListQuery & { status?: string | null; search?: string | null } = {},
  ): Promise<AdminUserListResponse> {
    const page = assertPage(query.page);
    const pageSize = assertPageSize(query.pageSize);
    const result = await this.readModel.listUsers({
      status: query.status ?? null,
      search: query.search ?? null,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  /** `GET /admin/providers`. */
  async listProviders(
    query: ListQuery & { approvalStatus?: string | null } = {},
  ): Promise<AdminProviderListResponse> {
    const page = assertPage(query.page);
    const pageSize = assertPageSize(query.pageSize);
    const result = await this.readModel.listProviders({
      approvalStatus: (query.approvalStatus ?? null) as AdminProviderQuery['approvalStatus'],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  /** `GET /admin/orders`. */
  async listOrders(
    query: ListQuery & { status?: string | null } = {},
  ): Promise<AdminOrderListResponse> {
    const page = assertPage(query.page);
    const pageSize = assertPageSize(query.pageSize);
    const result = await this.readModel.listOrders({
      status: (query.status ?? null) as AdminOrderQuery['status'],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  /** `GET /admin/audit-logs`. */
  async listAuditLogs(
    query: ListQuery & {
      actorUserId?: string | null;
      action?: string | null;
      resourceType?: string | null;
    } = {},
  ): Promise<AdminAuditLogListResponse> {
    const page = assertPage(query.page);
    const pageSize = assertPageSize(query.pageSize);
    const result = await this.readModel.listAuditLogs({
      actorUserId: query.actorUserId ?? null,
      action: query.action ?? null,
      resourceType: query.resourceType ?? null,
      skip: (page - 1) * pageSize,
      take: pageSize,
    } as AdminAuditLogQuery);
    return { ...result, page, pageSize };
  }

  /**
   * `POST /admin/users/:id/roles`.
   *
   * The only way to grant a role, and always audited with before/after: a role
   * is power, and `specs/12` §Audit lists "role change" first.
   */
  async grantRole(
    actor: AdminActor,
    userId: string,
    role: string,
  ): Promise<AdminRoleChangeResponse> {
    const assignable = assertRole(role);
    const before = await this.requireRoles(userId);

    await this.users.addRole(userId, assignable);
    const after = await this.users.listRoles(userId);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.roleGranted,
      resourceType: 'user_role',
      resourceId: userId,
      beforeJson: { roles: before },
      afterJson: { roles: after, granted: assignable },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { userId, roles: after as ApiRole[] };
  }

  /** `DELETE /admin/users/:id/roles/:role`: the audited counterpart. */
  async revokeRole(
    actor: AdminActor,
    userId: string,
    role: string,
  ): Promise<AdminRoleChangeResponse> {
    const revocable = assertRole(role);
    const before = await this.requireRoles(userId);

    await this.users.removeRole(userId, revocable);
    const after = await this.users.listRoles(userId);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.roleRevoked,
      resourceType: 'user_role',
      resourceId: userId,
      beforeJson: { roles: before },
      afterJson: { roles: after, revoked: revocable },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { userId, roles: after as ApiRole[] };
  }

  private async requireRoles(userId: string): Promise<ApiRole[]> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw adminNotFound('Account not found.');
    }
    return (await this.users.listRoles(userId)) as ApiRole[];
  }
}
