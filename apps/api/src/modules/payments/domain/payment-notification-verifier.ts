/**
 * Notification verification port (`specs/08-payment-and-settlement.md`
 * §Create payment steps 9–12: verify signature/decryption, then check amount,
 * order and provider transaction).
 *
 * A payment callback is unauthenticated input. The official WeChat v3 flow signs
 * it with the platform certificate and encrypts the payload, so verification is
 * an adapter concern (T015), not a controller one.
 */

/** Dependency-injection token for {@link PaymentNotificationVerifier}. */
export const PAYMENT_NOTIFICATION_VERIFIER = 'PAYMENT_NOTIFICATION_VERIFIER';

/** What the platform needs from a verified notification, and nothing else. */
export interface VerifiedNotification {
  /** Our order number (`out_trade_no`). */
  orderNo: string;
  /** The provider transaction id the payment row was created with. */
  providerTransactionId: string;
  amountMinor: number;
  status: 'SUCCEEDED' | 'FAILED' | 'CLOSED' | 'PENDING';
  /** Reference to wherever the raw notification is stored; never the payload. */
  rawRef: string | null;
}

export interface NotificationHeaders {
  [name: string]: string | string[] | undefined;
}

export interface PaymentNotificationVerifier {
  /**
   * Verify a server-to-server notification and return the platform's own view of
   * it.
   *
   * Throws when the signature is missing, unknown, stale or invalid, or when the
   * payload cannot be decrypted (`PAYMENT_CALLBACK_INVALID`).
   */
  verify(input: {
    headers: NotificationHeaders;
    /** The raw body, exactly as received: the signature covers these bytes. */
    body: string;
  }): Promise<VerifiedNotification>;
}
