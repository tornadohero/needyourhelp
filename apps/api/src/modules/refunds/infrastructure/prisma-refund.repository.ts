import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CreateRefundInput, Refund, RefundStatus } from '../domain/refund.model';
import type { RefundRepository } from '../domain/refund.repository';
import { MONEY_MOVING_REFUND_STATUSES } from '../domain/refund-policy';

/** Prisma adapter for {@link RefundRepository}. */
@Injectable()
export class PrismaRefundRepository implements RefundRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateRefundInput): Promise<Refund> {
    const row = await this.prisma.refund.create({
      data: {
        orderId: input.orderId,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        reason: input.reason,
        // Money has not moved yet: the gateway decides what happens next.
        status: 'REQUESTED',
      },
    });
    return mapRefund(row);
  }

  async findById(id: string): Promise<Refund | null> {
    const row = await this.prisma.refund.findUnique({ where: { id } });
    return row ? mapRefund(row) : null;
  }

  async listByOrder(orderId: string): Promise<Refund[]> {
    const rows = await this.prisma.refund.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapRefund);
  }

  async markStatus(id: string, status: RefundStatus, providerRef?: string | null): Promise<Refund> {
    const row = await this.prisma.refund.update({
      where: { id },
      data: { status, ...(providerRef === undefined ? {} : { providerRef }) },
    });
    return mapRefund(row);
  }

  async sumRefundedByOrder(
    orderId: string,
    statuses: readonly RefundStatus[] = MONEY_MOVING_REFUND_STATUSES,
  ): Promise<number> {
    const total = await this.prisma.refund.aggregate({
      where: { orderId, status: { in: [...statuses] } },
      _sum: { amountMinor: true },
    });
    return total._sum.amountMinor ?? 0;
  }
}

type RefundRow = {
  id: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  reason: string | null;
  status: RefundStatus;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    orderId: row.orderId,
    paymentId: row.paymentId,
    amountMinor: row.amountMinor,
    reason: row.reason,
    status: row.status,
    providerRef: row.providerRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
