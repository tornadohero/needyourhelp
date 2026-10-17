import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';
import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { IDEMPOTENCY_STORE } from '../../../common/idempotency/idempotency.store';
import type { IdempotencyStore } from '../../../common/idempotency/idempotency.store';
import { PROVIDER_DIRECTORY } from '../../discovery/domain/provider-directory';
import type { ProviderDirectory } from '../../discovery/domain/provider-directory';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { CHILD_PROFILE_REPOSITORY } from '../../profile/domain/child-profile.repository';
import type { ChildProfileRepository } from '../../profile/domain/child-profile.repository';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../provider/domain/provider-capability.repository';
import type { ProviderCapabilityRepository } from '../../provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import { providerNotFound } from '../../provider/domain/provider.errors';
import { TeacherComplianceService } from '../../compliance/application/teacher-compliance.service';
import { ProviderServiceService } from '../../services/application/provider-service.service';
import { AvailabilityService } from '../../availability/application/availability.service';
import {
  FEE_VERSION,
  PLATFORM_FEE_RATE_BPS,
  assertNote,
  assertPage,
  assertPageSize,
  assertScheduledWindow,
  calculateOrderMoney,
  canTransition,
  generateOrderNo,
} from '../domain/order-policy';
import { ORDER_REPOSITORY } from '../domain/order.repository';
import type { OrderRepository } from '../domain/order.repository';
import type { Order, OrderStatus } from '../domain/order.model';
import {
  orderForbidden,
  orderInvalidRequest,
  orderInvalidState,
  orderNotFound,
} from '../domain/order.errors';

export interface CreateOrderCommand {
  serviceId: string;
  childId?: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  note?: string | null;
}

/** The command routes of `specs/05-api-spec.md` §Orders. */
export type OrderCommand = 'cancel' | 'confirm' | 'start' | 'complete';

const COMMAND_TARGET: Record<OrderCommand, OrderStatus> = {
  cancel: 'CANCELLED',
  confirm: 'CONFIRMED',
  start: 'IN_PROGRESS',
  complete: 'COMPLETED',
};

/**
 * Orders (`specs/05-api-spec.md` §Orders, `specs/01-business-rules.md` §Orders).
 *
 * Two rules define this service:
 * - **the server calculates the money**: the client sends what it wants to
 *   book, and total, fee and payout come from the service price plus the fee
 *   version recorded with the order;
 * - **status changes are commands, never a PATCH**: every transition is looked
 *   up in the state machine and only the buyer (cancel) or the provider
 *   (confirm/start/complete) may issue it.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ProviderServiceService) private readonly services: ProviderServiceService,
    @Inject(TeacherComplianceService) private readonly compliance: TeacherComplianceService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(PROVIDER_DIRECTORY) private readonly directory: ProviderDirectory,
    @Inject(PROVIDER_CAPABILITY_REPOSITORY)
    private readonly capabilities: ProviderCapabilityRepository,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CHILD_PROFILE_REPOSITORY) private readonly children: ChildProfileRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotency: IdempotencyStore,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /**
   * `POST /orders`.
   *
   * Every gate of `specs/01-business-rules.md` §Orders runs before anything is
   * written: active provider, published service, valid customer, valid
   * availability, plus the teacher-compliance gate of T007.
   */
  async create(
    buyerUserId: string,
    command: CreateOrderCommand,
    idempotencyKey?: string,
  ): Promise<Order> {
    const fingerprint = JSON.stringify({
      buyer: buyerUserId,
      service: command.serviceId,
      child: command.childId ?? null,
      start: command.scheduledStart.toISOString(),
      end: command.scheduledEnd.toISOString(),
      note: command.note ?? null,
    });

    const work = async (): Promise<Order> => {
      const order = await this.placeOrder(buyerUserId, command);
      await this.analytics?.track({
        name: 'order_created',
        actorUserId: buyerUserId,
        providerId: order.providerId,
        serviceId: order.serviceId,
        orderId: order.id,
        // Money and "was it for a child" are metrics; the child is not.
        props: { amount_minor: order.amountMinor, has_child: order.childId !== null },
      });
      // The same delivery is the provider's funnel too.
      await this.analytics?.track({
        name: 'order_received',
        providerId: order.providerId,
        orderId: order.id,
        props: { amount_minor: order.amountMinor },
      });
      return order;
    };

    if (!idempotencyKey) {
      return work();
    }

    const { result } = await this.idempotency.runOnce(
      { scope: 'orders.create', key: idempotencyKey, fingerprint },
      work,
    );
    return result;
  }

  /** `GET /orders`: orders the account is a party to. */
  async listMine(userId: string, options: { page?: number; pageSize?: number } = {}) {
    const page = assertPage(options.page);
    const pageSize = assertPageSize(options.pageSize);
    const providerIds = await this.providerIdsOf(userId);
    const result = await this.orders.listForParticipant({ userId, providerIds, page, pageSize });
    return { ...result, page, pageSize };
  }

  /** `GET /orders/:id`: buyer or provider of that order, nobody else. */
  async getForParticipant(userId: string, orderId: string): Promise<Order> {
    const order = await this.requireParticipant(userId, orderId);
    return order;
  }

  /** Read an order by its number. */
  async findByOrderNo(orderNo: string): Promise<Order | null> {
    return this.orders.findByOrderNo(orderNo);
  }

  /**
   * Read an order by id.
   *
   * For contexts that already resolved the order through their own record (the
   * payment context holds `order_id`), not for callers who only have an id from a
   * client.
   */
  async findById(orderId: string): Promise<Order | null> {
    return this.orders.findById(orderId);
  }

  /**
   * `PENDING_PAYMENT -> PAID`: the only way an order becomes paid.
   *
   * Called by the payment context (T014) once the *server* has confirmed the
   * payment, never because a client said it succeeded
   * (`specs/08-payment-and-settlement.md` §Payment invariants). It is
   * idempotent: an already paid order is returned unchanged, so a replayed
   * callback cannot produce a second transition.
   */
  async markPaid(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }
    if (order.status === 'PAID') {
      return order;
    }
    if (!canTransition(order.status, 'PAID')) {
      throw orderInvalidState(`Illegal order transition ${order.status} -> PAID.`);
    }
    return this.orders.setStatus(order.id, 'PAID');
  }

  /**
   * Enter the refund branch: `PAID|CONFIRMED|IN_PROGRESS -> REFUND_PENDING`.
   *
   * Idempotent: an order already waiting for a refund is returned unchanged, so
   * a repeated request cannot fail on a second transition (T016).
   */
  async beginRefund(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }
    if (order.status === 'REFUND_PENDING') {
      return order;
    }
    if (!canTransition(order.status, 'REFUND_PENDING')) {
      throw orderInvalidState(`Illegal order transition ${order.status} -> REFUND_PENDING.`);
    }
    return this.orders.setStatus(order.id, 'REFUND_PENDING');
  }

  /** `REFUND_PENDING -> REFUNDED`: the money is back with the customer. */
  async completeRefund(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }
    if (order.status === 'REFUNDED') {
      return order;
    }
    if (!canTransition(order.status, 'REFUNDED')) {
      throw orderInvalidState(`Illegal order transition ${order.status} -> REFUNDED.`);
    }
    return this.orders.setStatus(order.id, 'REFUNDED');
  }

  /**
   * `PAID|CONFIRMED|IN_PROGRESS -> DISPUTED`: only moderation opens a dispute
   * (`specs/12-admin-spec.md` §Order operations: "mark dispute"), so the command
   * is here for that context to call and never a client route.
   */
  async markDispute(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }
    if (order.status === 'DISPUTED') {
      return order;
    }
    if (!canTransition(order.status, 'DISPUTED')) {
      throw orderInvalidState(`Illegal order transition ${order.status} -> DISPUTED.`);
    }
    return this.orders.setStatus(order.id, 'DISPUTED');
  }

  /**
   * A state command.
   *
   * `cancel` belongs to the buyer (while the order is unpaid);
   * `confirm`, `start` and `complete` belong to the provider that delivers it.
   */
  async runCommand(userId: string, orderId: string, command: OrderCommand): Promise<Order> {
    const order = await this.requireParticipant(userId, orderId);
    const providerIds = await this.providerIdsOf(userId);

    const isBuyer = order.buyerUserId === userId;
    const isProvider = providerIds.includes(order.providerId);

    if (command === 'cancel' && !isBuyer) {
      throw orderForbidden('Only the buyer can cancel an order.');
    }
    if (command !== 'cancel' && !isProvider) {
      throw orderForbidden('Only the provider can move this order forward.');
    }

    const target = COMMAND_TARGET[command];
    if (!canTransition(order.status, target)) {
      throw orderInvalidState(
        `Illegal order transition ${order.status} -> ${target} (command: ${command}).`,
      );
    }

    const updated = await this.orders.setStatus(order.id, target);

    // Completion is the trust signal discovery ranks on, and it is what unlocks
    // reviews (T017): both are counted from this command and nowhere else.
    if (target === 'COMPLETED') {
      await this.profiles.incrementCompletedOrderCount(order.providerId);

      await this.analytics?.track({
        name: 'order_completed',
        actorUserId: userId,
        providerId: order.providerId,
        orderId: order.id,
        props: {},
      });
    }

    // A cancelled order gives its time back: the slot is bookable again.
    if (target === 'CANCELLED' && order.scheduledStart && order.scheduledEnd) {
      await this.availability.release({
        providerId: order.providerId,
        startAt: order.scheduledStart,
        endAt: order.scheduledEnd,
      });
    }

    return updated;
  }

  private async placeOrder(buyerUserId: string, command: CreateOrderCommand): Promise<Order> {
    const window = assertScheduledWindow(command.scheduledStart, command.scheduledEnd);
    // `specs/05-api-spec.md` §Orders accepts a note, but `specs/04` §orders has
    // no column for it: the note is validated and deliberately not persisted
    // until the schema or the API says where it lives.
    assertNote(command.note);
    if (!isUuid(command.serviceId)) {
      throw orderInvalidRequest('Unknown service.');
    }

    // 1. Approved service, and the facts an order needs (price, duration, tags).
    const facts = await this.services.assertOrderable(command.serviceId);

    // 2. Active, discoverable provider (T010 owns the gate).
    const detail = await this.directory.findDiscoverable(facts.providerId);
    if (!detail) {
      throw providerNotFound('This provider cannot be ordered right now.');
    }

    // 3. A valid customer: active, and not the provider themselves.
    const buyer = await this.users.findById(buyerUserId);
    if (!buyer || buyer.deletedAt || buyer.status !== 'ACTIVE') {
      throw orderInvalidRequest('Your account cannot place orders.');
    }
    if (detail.provider.userId === buyerUserId) {
      throw orderInvalidRequest('You cannot order your own service.');
    }

    // 4. The child belongs to the buyer, and its consent was captured (T004).
    const childId = await this.assertChild(buyerUserId, command.childId ?? null);

    // 5. Teacher compliance: every capability of the provider must be permitted
    //    to deliver this service (T007 owns the rule).
    const capabilities = await this.capabilities.listByProvider(facts.providerId);
    for (const capability of capabilities) {
      await this.compliance.assertOrderable(facts.providerId, capability.capabilityType, {
        subjectCodes: facts.subjectCodes,
        cityCode: facts.cityCode,
        at: window.startAt,
      });
    }

    // 6. Valid availability: the slot decides the scheduled times, so the client
    //    cannot book a window the provider never offered.
    const booking = await this.availability.claim({
      providerId: facts.providerId,
      startAt: window.startAt,
      endAt: window.endAt,
    });

    // 7. The money: the server's arithmetic, snapshotted for good.
    const money = calculateOrderMoney(facts.priceMinor);

    try {
      return await this.orders.create({
        orderNo: generateOrderNo(),
        buyerUserId,
        providerId: facts.providerId,
        serviceId: facts.id,
        childId,
        domain: facts.domain,
        scheduledStart: booking.startAt,
        scheduledEnd: booking.endAt,
        amountMinor: money.amountMinor,
        platformFeeMinor: money.platformFeeMinor,
        providerAmountMinor: money.providerAmountMinor,
        currency: facts.currency,
        priceSnapshot: {
          serviceId: facts.id,
          title: facts.title,
          priceMinor: facts.priceMinor,
          currency: facts.currency,
          durationMinutes: facts.durationMinutes,
        },
        policySnapshot: {
          feeVersion: FEE_VERSION,
          feeRateBps: PLATFORM_FEE_RATE_BPS,
          // Cancellation policy is T016; the version is recorded either way.
          cancellationPolicyId: null,
        },
      });
    } catch (error) {
      // The order was not written: give the slot back so it stays bookable.
      await this.availability.release({
        providerId: facts.providerId,
        startAt: booking.startAt,
        endAt: booking.endAt,
      });
      throw error;
    }
  }

  /** The note is stored with the order; nothing else uses it yet. */
  private async assertChild(buyerUserId: string, childId: string | null): Promise<string | null> {
    if (childId === null) {
      return null;
    }
    if (!isUuid(childId)) {
      throw orderInvalidRequest('Unknown child.');
    }
    const child = await this.children.findById(childId);
    // Guardian ownership, and never a deleted child (T004).
    if (!child || child.deletedAt || child.guardianUserId !== buyerUserId) {
      throw orderInvalidRequest('This child profile is not available.');
    }
    return child.id;
  }

  private async requireParticipant(userId: string, orderId: string): Promise<Order> {
    if (!isUuid(orderId)) {
      throw orderNotFound();
    }
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw orderNotFound();
    }

    const providerIds = await this.providerIdsOf(userId);
    if (order.buyerUserId !== userId && !providerIds.includes(order.providerId)) {
      // Not found, not forbidden: an order id must not be probeable.
      throw orderNotFound();
    }
    return order;
  }

  private async providerIdsOf(userId: string): Promise<string[]> {
    return (await this.profiles.listByUser(userId)).map((profile) => profile.id);
  }
}
