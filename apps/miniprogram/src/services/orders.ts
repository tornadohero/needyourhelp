import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import { appendPage, hasMore, initialList, nextPage } from '../core/paging';
import type { ListState } from '../core/paging';
import { bookingRequest, slotOptions } from '../core/booking';
import type { BookingDraft, CreateOrderBody, SlotOptionView } from '../core/booking';
import { describeOrder, describeOrderDetail, describeRefund } from '../core/order-view';
import type { OrderDetailView, OrderRowView, RefundRowView } from '../core/order-view';
import type {
  AvailabilityListResponse,
  OrderListResponse,
  OrderResponse,
  RefundListResponse,
  RefundRequestResponse,
} from '@mentor/api-contracts';

/**
 * Booking and order use cases (T031).
 *
 * Every call goes through the session: an order belongs to whoever the token
 * says it is, and the client never sends a user id, a role or a status
 * (`AGENTS.md` §7, `specs/07-permission-spec.md`).
 *
 * A status is never written directly. Creating, cancelling and asking for a
 * refund are commands; the server owns the machine and answers 409 when the
 * state moved on, which a screen treats as "refresh" (`specs/06`).
 */

export interface OrderPage {
  items: OrderResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /providers/:id/availability` — the windows a booking may choose from. */
export async function bookableSlots(
  context: MentorContext,
  providerId: string,
): Promise<SlotOptionView[]> {
  const list = await context.client.get<AvailabilityListResponse>(
    fillPath(ROUTES.providerAvailability, { id: providerId }),
  );
  return slotOptions(list.items);
}

/**
 * `POST /orders`.
 *
 * The body is built by `bookingRequest()` and carries no money: the server
 * prices it (`specs/05-api-spec.md` §Orders). The answer is the order as the
 * server recorded it, snapshot included — what the screen shows afterwards is
 * never a locally computed total.
 */
export async function createOrder(
  context: MentorContext,
  draft: BookingDraft,
): Promise<OrderResponse> {
  const body: CreateOrderBody = bookingRequest(draft);
  return context.session.withSession((accessToken) =>
    context.client.post<OrderResponse>(ROUTES.orders, { accessToken, body }),
  );
}

/** `GET /orders` — bounded and paginated; a screen never asks for "everything". */
export async function listOrders(
  context: MentorContext,
  options: { page?: number; pageSize?: number } = {},
): Promise<OrderPage> {
  return context.session.withSession((accessToken) =>
    context.client.get<OrderListResponse>(ROUTES.orders, {
      accessToken,
      query: { page: options.page ?? 1, pageSize: options.pageSize ?? 20 },
    }),
  );
}

export async function loadOrders(
  context: MentorContext,
  options: { pageSize?: number } = {},
): Promise<ListState<OrderRowView>> {
  const page = await listOrders(context, { page: 1, pageSize: options.pageSize ?? 20 });
  const state = initialList<OrderRowView>(page.pageSize);
  return appendPage(state, {
    items: page.items.map(describeOrder),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  });
}

/** The next page, or the same list when nothing is left to fetch. */
export async function loadMoreOrders(
  context: MentorContext,
  state: ListState<OrderRowView>,
): Promise<{ state: ListState<OrderRowView>; loaded: boolean }> {
  const page = nextPage(state);
  if (page === null) {
    return { state, loaded: false };
  }

  const result = await listOrders(context, { page, pageSize: state.pageSize });
  const next = appendPage(state, {
    items: result.items.map(describeOrder),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });

  return { state: next, loaded: true };
}

export function canLoadMoreOrders(state: ListState<OrderRowView>): boolean {
  return hasMore(state);
}

/** `GET /orders/:id` plus its refunds: one screen, one round trip each. */
export async function orderDetail(
  context: MentorContext,
  orderId: string,
): Promise<{ order: OrderDetailView; refunds: RefundRowView[] }> {
  const [order, refunds] = await Promise.all([
    context.session.withSession((accessToken) =>
      context.client.get<OrderResponse>(fillPath(ROUTES.orderDetail, { id: orderId }), {
        accessToken,
      }),
    ),
    listRefunds(context, orderId),
  ]);

  return { order: describeOrderDetail(order), refunds };
}

/**
 * `POST /orders/:id/cancel` — a command, not a status write.
 *
 * Only a booking that was never paid can be cancelled; everything else asks for
 * a refund instead. The server decides, and a 409 means the screen is stale.
 */
export async function cancelOrder(
  context: MentorContext,
  orderId: string,
): Promise<OrderDetailView> {
  const order = await context.session.withSession((accessToken) =>
    context.client.post<OrderResponse>(fillPath(ROUTES.orderCancel, { id: orderId }), {
      accessToken,
    }),
  );
  return describeOrderDetail(order);
}

/**
 * `POST /orders/:id/refund-request` — the customer asks; no money moves.
 *
 * The amount is never sent: the server answers what it would still refund
 * (`specs/08-payment-and-settlement.md` §Refund), and only the audited admin
 * command moves it (`specs/12-admin-spec.md`).
 */
export async function requestRefund(
  context: MentorContext,
  orderId: string,
  options: { reason?: string } = {},
): Promise<RefundRequestResponse> {
  return context.session.withSession((accessToken) =>
    context.client.post<RefundRequestResponse>(
      fillPath(ROUTES.orderRefundRequest, { id: orderId }),
      { accessToken, body: options.reason ? { reason: options.reason } : {} },
    ),
  );
}

/** `GET /orders/:id/refunds` — the progress of what was asked for. */
export async function listRefunds(
  context: MentorContext,
  orderId: string,
): Promise<RefundRowView[]> {
  const list = await context.session.withSession((accessToken) =>
    context.client.get<RefundListResponse>(fillPath(ROUTES.orderRefunds, { id: orderId }), {
      accessToken,
    }),
  );
  return list.items.map(describeRefund);
}
