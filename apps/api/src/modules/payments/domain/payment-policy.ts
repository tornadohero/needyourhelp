import { paymentCallbackInvalid } from './payment.errors';

/**
 * Payment rules (`specs/08-payment-and-settlement.md` §Payment invariants).
 *
 * The three invariants T014 must enforce are here: a client amount is never
 * trusted, a mismatched amount is rejected, and a repeated callback is a no-op
 * instead of a second state transition.
 */

/** Idempotency scopes (`specs/03-architecture-spec.md` §Idempotency). */
export const IDEMPOTENCY_SCOPES = {
  session: 'payments.session',
  callback: 'payments.callback',
} as const;

/**
 * The amount the provider reports must equal the amount the server calculated.
 *
 * Nothing else is acceptable: a mismatch is rejected and the payment is marked
 * failed, never silently adjusted (`specs/08`: "Amount mismatch => reject
 * callback", "Never trust client amount").
 */
export function assertAmountMatches(expectedMinor: number, actualMinor: number): void {
  if (!Number.isInteger(actualMinor) || actualMinor !== expectedMinor) {
    throw paymentCallbackInvalid(
      `The payment amount (${String(actualMinor)}) does not match the order (${expectedMinor}).`,
    );
  }
}

/**
 * Shape of a server-to-server notification.
 *
 * A callback is unauthenticated input: everything is validated before it can
 * touch an order. Signature verification belongs to the WeChat adapter (T015);
 * the mock gateway has no signature to check.
 */
export interface PaymentCallbackPayload {
  orderNo: string;
  providerTransactionId: string;
  amountMinor: number;
  status: 'SUCCEEDED' | 'FAILED' | 'CLOSED' | 'PENDING';
  rawRef: string | null;
}

export function parseCallbackPayload(body: unknown): PaymentCallbackPayload {
  if (typeof body !== 'object' || body === null) {
    throw paymentCallbackInvalid('The notification payload is not an object.');
  }

  const raw = body as Record<string, unknown>;
  const orderNo = typeof raw.orderNo === 'string' ? raw.orderNo.trim() : '';
  const providerTransactionId =
    typeof raw.providerTransactionId === 'string' ? raw.providerTransactionId.trim() : '';
  const amountMinor = raw.amountMinor;
  const status = raw.status;

  if (orderNo.length === 0) {
    throw paymentCallbackInvalid('The notification carries no order number.');
  }
  if (providerTransactionId.length === 0) {
    throw paymentCallbackInvalid('The notification carries no provider transaction id.');
  }
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor)) {
    throw paymentCallbackInvalid('The notification carries no integer amount.');
  }
  if (
    status !== 'SUCCEEDED' &&
    status !== 'FAILED' &&
    status !== 'CLOSED' &&
    status !== 'PENDING'
  ) {
    throw paymentCallbackInvalid('The notification carries an unknown status.');
  }

  return {
    orderNo,
    providerTransactionId,
    amountMinor,
    status,
    rawRef: typeof raw.rawRef === 'string' ? raw.rawRef : null,
  };
}

/** A payment is still waiting for confirmation. */
export function isOpen(status: string): boolean {
  return status === 'INITIATED' || status === 'PENDING';
}

/**
 * Order number as the payment provider sees it: letters and digits only.
 *
 * WeChat's `out_trade_no` allows `[A-Za-z0-9]` and 6–32 characters, so the
 * human-facing `MO-20261001-ABCDEF01` is sent without separators and compared
 * back the same way.
 */
export function normalizeOrderNumber(orderNo: string): string {
  return orderNo.replace(/[^A-Za-z0-9]/g, '');
}
