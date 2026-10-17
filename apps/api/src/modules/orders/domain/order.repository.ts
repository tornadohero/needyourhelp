import type { CreateOrderInput, Order, OrderPage, OrderStatus } from './order.model';

/** Dependency-injection token for {@link OrderRepository}. */
export const ORDER_REPOSITORY = 'ORDER_REPOSITORY';

/**
 * Persistence port for the order aggregate.
 *
 * There is no delete and no generic update: an order is a commercial record, and
 * the only mutation is a state command whose transition was checked in the
 * domain (`specs/06-verification-state-machine.md` §Order).
 */
export interface OrderRepository {
  create(input: CreateOrderInput): Promise<Order>;

  findById(id: string): Promise<Order | null>;

  findByOrderNo(orderNo: string): Promise<Order | null>;

  /**
   * Orders the account participates in: as the buyer or as the provider.
   *
   * `providerIds` are the provider profiles the account owns, resolved by the
   * provider context (T005) — this port never looks them up itself.
   */
  listForParticipant(options: {
    userId: string;
    providerIds: string[];
    page: number;
    pageSize: number;
  }): Promise<OrderPage>;

  /** Only ever called with a status the state machine allowed. */
  setStatus(id: string, status: OrderStatus): Promise<Order>;
}
