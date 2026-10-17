import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreatePaymentInput,
  Payment,
  PaymentConfirmation,
  PaymentProvider,
  PaymentStatus,
} from '../domain/payment.model';
import type { PaymentRepository } from '../domain/payment.repository';

/** Prisma adapter for {@link PaymentRepository}. */
@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const row = await this.prisma.payment.create({
      data: {
        orderId: input.orderId,
        provider: input.provider,
        providerTransactionId: input.providerTransactionId,
        // The provider has not confirmed anything yet.
        status: 'INITIATED',
        amountMinor: input.amountMinor,
        prepayReference: input.prepayReference,
      },
    });
    return mapPayment(row);
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? mapPayment(row) : null;
  }

  async findByProviderTransactionId(providerTransactionId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { providerTransactionId } });
    return row ? mapPayment(row) : null;
  }

  async findLatestByOrder(orderId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapPayment(row) : null;
  }

  async listByOrder(orderId: string): Promise<Payment[]> {
    const rows = await this.prisma.payment.findMany({
      where: { orderId },
      // Newest first, and `id` breaks the tie: `created_at` is a millisecond
      // timestamp, so two attempts of the same order can share one.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(mapPayment);
  }

  async markSucceeded(id: string, confirmation: PaymentConfirmation): Promise<Payment> {
    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id } });
      if (!current) {
        throw new Error(`unknown payment ${id}`);
      }
      // Already succeeded: a replayed callback changes nothing at all.
      if (current.status === 'SUCCEEDED') {
        return mapPayment(current);
      }

      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          providerTransactionId: confirmation.providerTransactionId,
          paidAt: confirmation.paidAt,
          rawCallbackRef: confirmation.rawCallbackRef,
        },
      });
      return mapPayment(updated);
    });
  }

  async markStatus(id: string, status: PaymentStatus): Promise<Payment> {
    const row = await this.prisma.payment.update({ where: { id }, data: { status } });
    return mapPayment(row);
  }
}

type PaymentRow = {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  providerTransactionId: string | null;
  status: PaymentStatus;
  amountMinor: number;
  prepayReference: string | null;
  paidAt: Date | null;
  rawCallbackRef: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerTransactionId: row.providerTransactionId,
    status: row.status,
    amountMinor: row.amountMinor,
    prepayReference: row.prepayReference,
    paidAt: row.paidAt,
    rawCallbackRef: row.rawCallbackRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
