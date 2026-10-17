import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminAuditLogResponse,
  AdminDashboardCounts,
  AdminOrderListItemResponse,
  AdminProviderListItemResponse,
  AdminUserResponse,
  ApiRole,
  ModerationCaseStatusName,
  OrderStatusName,
} from '@mentor/api-contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AdminAuditLogQuery,
  AdminOrderQuery,
  AdminPage,
  AdminProviderQuery,
  AdminReadModel,
  AdminUserQuery,
} from '../domain/admin-read-model';
import { ORDER_STATUSES } from '@mentor/api-contracts';

/**
 * Prisma adapter for {@link AdminReadModel}.
 *
 * Every query is bounded and indexed: `users(status)`,
 * `provider_profiles(approval_status)`, `orders(status, scheduled_start)` and
 * `audit_logs(actor_user_id, created_at)`. The dashboard is a handful of counts
 * and one sum, never a scan of the platform.
 */
@Injectable()
export class PrismaAdminReadModel implements AdminReadModel {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async dashboard(): Promise<AdminDashboardCounts> {
    const [userTotal, userActive, providers, orderTotal, gmv, refunds, openCases, byStatusRows] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        this.prisma.providerProfile.groupBy({
          by: ['approvalStatus'],
          _count: { _all: true },
        }),
        this.prisma.order.count(),
        this.prisma.order.aggregate({
          where: { status: { in: PAID_AND_BEYOND } },
          _sum: { amountMinor: true },
        }),
        this.prisma.refund.aggregate({
          where: { status: { in: ['SUCCEEDED', 'PROCESSING'] } },
          _sum: { amountMinor: true },
        }),
        this.prisma.moderationCase.count({ where: { status: { in: OPEN_CASE_STATUSES } } }),
        this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

    const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<
      OrderStatusName,
      number
    >;
    for (const row of byStatusRows) {
      byStatus[row.status as OrderStatusName] = row._count._all;
    }

    const approved = this.countOf(providers, 'APPROVED');
    const suspended = this.countOf(providers, 'SUSPENDED');
    const pendingReview =
      this.countOf(providers, 'SUBMITTED') + this.countOf(providers, 'UNDER_REVIEW');
    const completed = byStatus.COMPLETED;
    const paidAndBeyond = PAID_AND_BEYOND.reduce((total, status) => total + byStatus[status], 0);

    return {
      users: { total: userTotal, active: userActive },
      providers: {
        total: providers.reduce((total, row) => total + row._count._all, 0),
        approved,
        pendingReview,
        suspended,
      },
      orders: {
        total: orderTotal,
        byStatus,
        gmvMinor: gmv._sum.amountMinor ?? 0,
        completed,
      },
      refunds: { totalMinor: refunds._sum.amountMinor ?? 0 },
      moderation: { openCases },
      conversion: {
        // Completed over everything that was paid for, in basis points.
        paidToCompletedBps:
          paidAndBeyond === 0 ? 0 : Math.round((completed / paidAndBeyond) * 10_000),
      },
    };
  }

  async countAdmins(): Promise<number> {
    return this.prisma.userRole.count({ where: { role: 'ADMIN' } });
  }

  async listUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserResponse>> {
    const where = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? { displayName: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: query.skip,
      take: query.take,
      // No phone, no WeChat identifier: an operator needs none of it.
      select: { id: true, displayName: true, status: true, createdAt: true },
    });
    const [roles, total] = await Promise.all([
      this.rolesFor(rows.map((row) => row.id)),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        status: row.status,
        roles: roles.get(row.id) ?? [],
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  async listProviders(
    query: AdminProviderQuery,
  ): Promise<AdminPage<AdminProviderListItemResponse>> {
    const where = query.approvalStatus ? { approvalStatus: query.approvalStatus } : {};
    const [rows, total] = await Promise.all([
      this.prisma.providerProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.providerProfile.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        publicName: row.publicName,
        providerType: row.providerType,
        approvalStatus: row.approvalStatus,
        searchable: row.searchable,
        ratingAvg: row.ratingAvg === null ? null : row.ratingAvg.toNumber(),
        ratingCount: row.ratingCount,
        completedOrderCount: row.completedOrderCount,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  async listOrders(query: AdminOrderQuery): Promise<AdminPage<AdminOrderListItemResponse>> {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        status: row.status,
        amountMinor: row.amountMinor,
        currency: row.currency,
        buyerUserId: row.buyerUserId,
        providerId: row.providerId,
        scheduledStart: row.scheduledStart ? row.scheduledStart.toISOString() : null,
        scheduledEnd: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  async listAuditLogs(query: AdminAuditLogQuery): Promise<AdminPage<AdminAuditLogResponse>> {
    const where = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      // The snapshots stay internal (`AGENTS.md` §9): the page lists who did
      // what to which resource, and an operator reads the detail in a case.
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorType: row.actorType,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  private countOf(
    rows: { approvalStatus: string; _count: { _all: number } }[],
    status: string,
  ): number {
    return rows.find((row) => row.approvalStatus === status)?._count._all ?? 0;
  }

  /** Batch read: a listing never queries roles per row. */
  private async rolesFor(userIds: string[]): Promise<Map<string, ApiRole[]>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.userRole.findMany({ where: { userId: { in: userIds } } });
    const byUser = new Map<string, ApiRole[]>();
    for (const row of rows) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.role as ApiRole]);
    }
    return byUser;
  }
}

/**
 * GMV counts orders that actually moved money: everything from `PAID` onwards
 * except the refunded branch, which is reported separately.
 */
const PAID_AND_BEYOND: OrderStatusName[] = [
  'PAID',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'DISPUTED',
];

/** The moderation statuses that mean "still being handled" (T018). */
const OPEN_CASE_STATUSES: ModerationCaseStatusName[] = [
  'OPEN',
  'INVESTIGATING',
  'ACTION_REQUIRED',
  'APPEALED',
];
