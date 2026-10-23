import type {
  OrderResponse,
  OrderStatusName,
  RefundResponse,
  RefundStatusName,
} from '@mentor/api-contracts';

import { formatDateTime, formatDuration, formatMoney } from './format';

/**
 * Order view models (T031).
 *
 * A screen never renders a raw order row: it renders these fields, built one by
 * one from the contract (`AGENTS.md` §10).
 *
 * Two rules shape everything here:
 * - **money is only formatted, never computed** (`AGENTS.md` §8): the total, the
 *   unit price and the fee are whatever the server decided at booking time, and
 *   the snapshot is what the customer pays even if the service price changed
 *   since (`specs/04-database-spec.md` §orders);
 * - **a status is read, never written**: a screen offers a command and the server
 *   decides. `ORDER_INVALID_STATE` (409) means "refresh", not "retry the write"
 *   (`specs/06-verification-state-machine.md` §Order).
 */

export const ORDER_STATUS_LABELS: Record<OrderStatusName, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  CONFIRMED: '导师已接单',
  IN_PROGRESS: '服务中',
  COMPLETED: '已完成',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
  DISPUTED: '争议处理中',
};

/**
 * What the screen may offer, mirroring `ORDER_TRANSITIONS`.
 *
 * The client is allowed to hide a button the server would refuse, but it is not
 * allowed to assume the answer: every command can still come back 409, and the
 * page refreshes when it does.
 */
export interface OrderActions {
  /** Payment is a later task; the state is shown so nothing looks stuck. */
  canPay: boolean;
  canCancel: boolean;
  canRequestRefund: boolean;
}

export function actionsFor(status: OrderStatusName): OrderActions {
  return {
    canPay: status === 'PENDING_PAYMENT',
    canCancel: status === 'PENDING_PAYMENT',
    canRequestRefund: status === 'PAID' || status === 'CONFIRMED' || status === 'IN_PROGRESS',
  };
}

export interface OrderRowView {
  id: string;
  orderNo: string;
  /** Which provider has to deliver it; a participant list mixes both sides. */
  providerId: string;
  status: OrderStatusName;
  statusText: string;
  /** Service title from the price snapshot: what was bought, at booking time. */
  title: string;
  timeText: string;
  amountText: string;
  canPay: boolean;
  canCancel: boolean;
  canRequestRefund: boolean;
}

export function describeOrder(order: OrderResponse): OrderRowView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    providerId: order.providerId,
    status: order.status,
    statusText: ORDER_STATUS_LABELS[order.status],
    title: order.priceSnapshot.title,
    timeText: scheduledText(order),
    amountText: moneyText(order.amountMinor, order.currency),
    ...actionsFor(order.status),
  };
}

/**
 * The money screen (`specs/11-pages-and-ui.md` §Money screens).
 *
 * Service, duration, unit price, total and order number are all here. The
 * platform fee is deliberately absent: the spec only requires it when a
 * customer-facing policy asks for it, and none does yet.
 */
export interface OrderDetailView extends OrderRowView {
  durationText: string;
  unitPriceText: string;
  totalText: string;
  createdText: string;
  updatedText: string;
  /**
   * Whether a child profile is attached.
   *
   * The order carries a child **id** and nothing else, so this says "attached"
   * and never a name: no endpoint on this screen returns child detail
   * (`specs/10-privacy-and-minors.md`).
   */
  childText: string;
}

export function describeOrderDetail(order: OrderResponse): OrderDetailView {
  return {
    ...describeOrder(order),
    durationText: formatDuration(order.priceSnapshot.durationMinutes),
    unitPriceText: moneyText(order.priceSnapshot.priceMinor, order.priceSnapshot.currency),
    totalText: moneyText(order.amountMinor, order.currency),
    createdText: formatDateTime(order.createdAt),
    updatedText: formatDateTime(order.updatedAt),
    childText: order.childId === null ? '未关联孩子档案' : '已关联孩子档案',
  };
}

export const REFUND_STATUS_LABELS: Record<RefundStatusName, string> = {
  REQUESTED: '退款已申请',
  PROCESSING: '退款处理中',
  SUCCEEDED: '已退款',
  FAILED: '退款失败',
  REJECTED: '退款被驳回',
};

export interface RefundRowView {
  id: string;
  statusText: string;
  amountText: string;
  reasonText: string;
  createdText: string;
}

export function describeRefund(refund: RefundResponse): RefundRowView {
  return {
    id: refund.id,
    statusText: REFUND_STATUS_LABELS[refund.status],
    amountText: moneyText(refund.amountMinor),
    // A reason is optional server-side; an empty reason shows nothing invented.
    reasonText: refund.reason ?? '',
    createdText: formatDateTime(refund.createdAt),
  };
}

/**
 * The scheduled window.
 *
 * Both ends can be null only in theory (a booking always has one); the text is
 * honestly empty rather than "now" when they are.
 */
function scheduledText(order: OrderResponse): string {
  if (order.scheduledStart === null || order.scheduledEnd === null) {
    return '';
  }
  return `${formatDateTime(order.scheduledStart)} – ${formatDateTime(order.scheduledEnd)}`;
}

/** Only the symbol is decided here; the digits are the server's. */
function moneyText(minor: number, currency = 'CNY'): string {
  return formatMoney(minor, currency === 'CNY' ? '¥' : `${currency} `);
}
