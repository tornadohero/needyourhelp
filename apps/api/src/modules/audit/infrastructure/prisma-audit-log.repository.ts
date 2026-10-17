import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuditLog } from '../domain/audit-log.model';
import type { AuditLogRepository, RecordAuditLogInput } from '../domain/audit-log.repository';

/** Prisma adapter for {@link AuditLogRepository}. */
@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        beforeJson: toJsonValue(input.beforeJson),
        afterJson: toJsonValue(input.afterJson),
        ipHash: input.ipHash ?? null,
        requestId: input.requestId,
      },
    });
  }

  /** Test/debug helper: read the rows written for a resource. */
  async listByResource(resourceType: string, resourceId: string): Promise<AuditLog[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorType: row.actorType,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      beforeJson: asRecord(row.beforeJson),
      afterJson: asRecord(row.afterJson),
      ipHash: row.ipHash,
      requestId: row.requestId,
      createdAt: row.createdAt,
    }));
  }
}

/** `undefined` leaves the column at its default; `null` writes SQL NULL. */
function toJsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
