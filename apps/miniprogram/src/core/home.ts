import type { OrderStatusName } from '@mentor/api-contracts';

/**
 * Home (P0) — "what do I do next", for both sides of the marketplace.
 *
 * The screen is a to-do list, not a nav wall: every card is an order and a
 * single next action. Nothing here is invented — the action comes from the
 * status the server returned, and the money on a card is the order's own
 * amount, never a sum the client computed (G7 owns earnings).
 */

export type HomeRole = 'parent' | 'provider';

/** What a card asks the user to do. `view` means "there is nothing to do yet". */
export type HomeAction = 'pay' | 'wait' | 'confirm' | 'start' | 'complete' | 'view';

export interface NextActionView {
  orderId: string;
  /** What was bought, from the order's price snapshot. */
  title: string;
  statusText: string;
  /** When it happens, phrased the way a person asks: 今天/明天/日期. */
  whenText: string;
  /** What the user is expected to do, in one short sentence. */
  hint: string;
  action: HomeAction;
  actionText: string;
  /** Within a day, or already due: these go first. */
  urgent: boolean;
}

const DAY_MS = 24 * 60 * 60_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Same day? Used for "today's lessons" — the provider's first question. */
export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** `今天 19:00` / `明天 19:00` / `11月3日 19:00`, or empty when unscheduled. */
export function whenText(iso: string | null, now: Date = new Date()): string {
  if (iso === null) {
    return '';
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return '';
  }

  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - startOfToday) / DAY_MS,
  );

  if (days === 0) {
    return `今天 ${clock}`;
  }
  if (days === 1) {
    return `明天 ${clock}`;
  }
  if (days === -1) {
    return `昨天 ${clock}`;
  }
  return `${at.getMonth() + 1}月${at.getDate()}日 ${clock}`;
}

/** Urgent means the user has to look now: due within a day, or already due. */
export function isUrgent(iso: string | null, now: Date = new Date()): boolean {
  if (iso === null) {
    return false;
  }
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return false;
  }
  return at - now.getTime() <= DAY_MS;
}

/** Parent side: the order asks for payment, or patience, or just shows up. */
function parentAction(status: OrderStatusName): { action: HomeAction; hint: string; text: string } {
  switch (status) {
    case 'PENDING_PAYMENT':
      return { action: 'pay', hint: '完成支付后导师才会收到预约。', text: '去支付' };
    case 'PAID':
      return { action: 'wait', hint: '已支付，等待导师接单。', text: '查看详情' };
    case 'CONFIRMED':
      return { action: 'view', hint: '导师已接单，按时上课即可。', text: '查看详情' };
    case 'IN_PROGRESS':
      return { action: 'view', hint: '课程进行中。', text: '查看详情' };
    default:
      return { action: 'view', hint: '', text: '查看详情' };
  }
}

/** Provider side: accept, start, finish — the three commands the server owns. */
function providerAction(status: OrderStatusName): {
  action: HomeAction;
  hint: string;
  text: string;
} {
  switch (status) {
    case 'PAID':
      return { action: 'confirm', hint: '家长已付款，接单后课程才算定。', text: '接单' };
    case 'CONFIRMED':
      return { action: 'start', hint: '到时间就开始服务。', text: '开始服务' };
    case 'IN_PROGRESS':
      return { action: 'complete', hint: '上完了就标记完成，进入结算。', text: '完成服务' };
    default:
      return { action: 'view', hint: '', text: '查看详情' };
  }
}

/** A status worth showing on a to-do list; finished money states are not. */
export function isPending(status: OrderStatusName): boolean {
  return (
    status === 'PENDING_PAYMENT' ||
    status === 'PAID' ||
    status === 'CONFIRMED' ||
    status === 'IN_PROGRESS'
  );
}

export interface HomeOrderLike {
  id: string;
  status: OrderStatusName;
  statusText: string;
  title: string;
  timeText: string;
  scheduledStart: string | null;
  providerId: string;
}

/** Build one card. The role decides whose next step it is. */
export function describeNextAction(
  order: HomeOrderLike,
  role: HomeRole,
  now: Date = new Date(),
): NextActionView {
  const next = role === 'parent' ? parentAction(order.status) : providerAction(order.status);

  return {
    orderId: order.id,
    title: order.title,
    statusText: order.statusText,
    whenText: order.scheduledStart === null ? '' : whenText(order.scheduledStart, now),
    hint: next.hint,
    action: next.action,
    actionText: next.text,
    urgent: isUrgent(order.scheduledStart, now),
  };
}

/** The to-do list: pending orders only, the urgent ones first. */
export function buildToDo(
  orders: HomeOrderLike[],
  role: HomeRole,
  now: Date = new Date(),
): NextActionView[] {
  return orders
    .filter((order) => isPending(order.status))
    .map((order) => describeNextAction(order, role, now))
    .sort((left, right) => Number(right.urgent) - Number(left.urgent));
}

/** Today's lessons — the provider's opening question: what do I teach today. */
export function buildToday(orders: HomeOrderLike[], now: Date = new Date()): NextActionView[] {
  return orders
    .filter(
      (order) => order.scheduledStart !== null && isSameDay(new Date(order.scheduledStart), now),
    )
    .map((order) => describeNextAction(order, 'provider', now));
}
