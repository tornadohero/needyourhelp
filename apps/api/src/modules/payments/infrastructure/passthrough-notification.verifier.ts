import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import { paymentCallbackInvalid } from '../domain/payment.errors';
import type {
  NotificationHeaders,
  PaymentNotificationVerifier,
  VerifiedNotification,
} from '../domain/payment-notification-verifier';
import { parseCallbackPayload } from '../domain/payment-policy';

export interface PassthroughNotificationVerifierOptions {
  environment?: string;
}

/**
 * Notification verifier for the mock adapter.
 *
 * There is no signature to check and nothing to decrypt: the payload is the
 * platform's own shape, already validated. It exists so a payment gateway and
 * its notification format are always selected as a pair — and it refuses to run
 * in production, where only the real WeChat verification (T015) is acceptable.
 */
export class PassthroughNotificationVerifier implements PaymentNotificationVerifier {
  constructor(private readonly options: PassthroughNotificationVerifierOptions = {}) {}

  async verify(input: {
    headers: NotificationHeaders;
    body: string;
  }): Promise<VerifiedNotification> {
    if (!isMockAdapterAllowed(this.options.environment)) {
      throw paymentCallbackInvalid(
        'The mock payment adapter is not allowed in production; configure WeChat Pay.',
      );
    }

    let parsed: ReturnType<typeof parseCallbackPayload>;
    try {
      parsed = parseCallbackPayload(JSON.parse(input.body));
    } catch {
      throw paymentCallbackInvalid('The notification payload is not valid JSON.');
    }

    return {
      orderNo: parsed.orderNo,
      providerTransactionId: parsed.providerTransactionId,
      amountMinor: parsed.amountMinor,
      status: parsed.status,
      rawRef: parsed.rawRef,
    };
  }
}
