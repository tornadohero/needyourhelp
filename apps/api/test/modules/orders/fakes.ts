import type { ChildProfile } from '../../../src/modules/profile/domain/child-profile.model';
import type { ChildProfileRepository } from '../../../src/modules/profile/domain/child-profile.repository';
import type {
  CreateOrderInput,
  Order,
  OrderPage,
  OrderStatus,
} from '../../../src/modules/orders/domain/order.model';
import type { OrderRepository } from '../../../src/modules/orders/domain/order.repository';

/** In-memory {@link OrderRepository}. */
export class FakeOrderRepository implements OrderRepository {
  readonly orders = new Map<string, Order>();
  private sequence = 0;

  /** Test seam: fail the next write, to prove a claimed slot is given back. */
  failNextCreate = false;

  async create(input: CreateOrderInput): Promise<Order> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('database unavailable');
    }

    this.sequence += 1;
    const now = new Date();
    const order: Order = {
      id: `00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`,
      orderNo: input.orderNo,
      buyerUserId: input.buyerUserId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      childId: input.childId,
      domain: input.domain,
      // An order always starts unpaid.
      status: 'PENDING_PAYMENT',
      amountMinor: input.amountMinor,
      platformFeeMinor: input.platformFeeMinor,
      providerAmountMinor: input.providerAmountMinor,
      currency: input.currency,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      priceSnapshot: input.priceSnapshot,
      policySnapshot: input.policySnapshot,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }

  async findByOrderNo(orderNo: string): Promise<Order | null> {
    return [...this.orders.values()].find((order) => order.orderNo === orderNo) ?? null;
  }

  async listForParticipant(options: {
    userId: string;
    providerIds: string[];
    page: number;
    pageSize: number;
  }): Promise<OrderPage> {
    const matching = [...this.orders.values()].filter(
      (order) =>
        order.buyerUserId === options.userId || options.providerIds.includes(order.providerId),
    );

    return {
      items: matching.slice((options.page - 1) * options.pageSize, options.page * options.pageSize),
      total: matching.length,
    };
  }

  async setStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = this.orders.get(id);
    if (!order) {
      throw new Error(`unknown order ${id}`);
    }
    const updated: Order = { ...order, status, updatedAt: new Date() };
    this.orders.set(id, updated);
    return updated;
  }
}

/** In-memory {@link ChildProfileRepository}, just enough for order guards. */
export class FakeChildProfileRepository implements ChildProfileRepository {
  readonly children = new Map<string, ChildProfile>();

  async add(
    child: Partial<ChildProfile> & { id: string; guardianUserId: string },
  ): Promise<ChildProfile> {
    const record: ChildProfile = {
      id: child.id,
      guardianUserId: child.guardianUserId,
      nickname: child.nickname ?? '孩子',
      birthYear: child.birthYear ?? null,
      gradeCode: child.gradeCode ?? 'PRIMARY_1',
      schoolName: child.schoolName ?? null,
      learningGoals: child.learningGoals ?? null,
      dataProcessingConsentStatus: child.dataProcessingConsentStatus ?? 'GRANTED',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: child.deletedAt ?? null,
    };
    this.children.set(record.id, record);
    return record;
  }

  async create(): Promise<ChildProfile> {
    throw new Error('not used in order tests');
  }

  async findById(id: string): Promise<ChildProfile | null> {
    return this.children.get(id) ?? null;
  }

  async listByGuardian(guardianUserId: string): Promise<ChildProfile[]> {
    return [...this.children.values()].filter(
      (child) => child.guardianUserId === guardianUserId && !child.deletedAt,
    );
  }

  async update(): Promise<ChildProfile> {
    throw new Error('not used in order tests');
  }

  async softDelete(): Promise<void> {
    throw new Error('not used in order tests');
  }

  async setConsentStatusForGuardian(): Promise<number> {
    throw new Error('not used in order tests');
  }
}
