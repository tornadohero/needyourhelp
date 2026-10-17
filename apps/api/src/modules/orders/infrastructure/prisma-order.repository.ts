import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateOrderInput,
  Order,
  OrderDomain,
  OrderPage,
  OrderPolicySnapshot,
  OrderPriceSnapshot,
  OrderStatus,
} from '../domain/order.model';
import type { OrderRepository } from '../domain/order.repository';

/** Prisma adapter for {@link OrderRepository}. */
@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateOrderInput): Promise<Order> {
    const row = await this.prisma.order.create({
      data: {
        orderNo: input.orderNo,
        buyerUserId: input.buyerUserId,
        providerId: input.providerId,
        serviceId: input.serviceId,
        childId: input.childId,
        domain: input.domain,
        // An order always starts unpaid; payment (T014) moves it on.
        status: 'PENDING_PAYMENT',
        amountMinor: input.amountMinor,
        platformFeeMinor: input.platformFeeMinor,
        providerAmountMinor: input.providerAmountMinor,
        currency: input.currency,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        priceSnapshot: toJson(input.priceSnapshot),
        policySnapshot: toJson(input.policySnapshot),
      },
    });
    return mapOrder(row);
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? mapOrder(row) : null;
  }

  async findByOrderNo(orderNo: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { orderNo } });
    return row ? mapOrder(row) : null;
  }

  async listForParticipant(options: {
    userId: string;
    providerIds: string[];
    page: number;
    pageSize: number;
  }): Promise<OrderPage> {
    const where = {
      OR: [
        { buyerUserId: options.userId },
        ...(options.providerIds.length > 0 ? [{ providerId: { in: options.providerIds } }] : []),
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
    ]);

    return { items: rows.map(mapOrder), total };
  }

  async setStatus(id: string, status: OrderStatus): Promise<Order> {
    const row = await this.prisma.order.update({ where: { id }, data: { status } });
    return mapOrder(row);
  }
}

type OrderRow = {
  id: string;
  orderNo: string;
  buyerUserId: string;
  providerId: string;
  serviceId: string;
  childId: string | null;
  domain: OrderDomain;
  status: OrderStatus;
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  currency: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  priceSnapshot: unknown;
  policySnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    orderNo: row.orderNo,
    buyerUserId: row.buyerUserId,
    providerId: row.providerId,
    serviceId: row.serviceId,
    childId: row.childId,
    domain: row.domain,
    status: row.status,
    amountMinor: row.amountMinor,
    platformFeeMinor: row.platformFeeMinor,
    providerAmountMinor: row.providerAmountMinor,
    currency: row.currency,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    priceSnapshot: asSnapshot<OrderPriceSnapshot>(row.priceSnapshot),
    policySnapshot: asSnapshot<OrderPolicySnapshot>(row.policySnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The snapshots are written by this adapter, so their shape is guaranteed. */
function asSnapshot<T>(value: unknown): T {
  return value as T;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
