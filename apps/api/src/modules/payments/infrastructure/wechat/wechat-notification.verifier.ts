import { paymentCallbackInvalid } from '../../domain/payment.errors';
import type {
  NotificationHeaders,
  PaymentNotificationVerifier,
  VerifiedNotification,
} from '../../domain/payment-notification-verifier';
import { decryptResource, verifyRsaSha256 } from './wechat-pay-crypto';
import type { WeChatPayConfig } from './wechat-pay-config';
import type { WeChatCertificateProvider } from './wechat-certificate.provider';
import { mapTradeState } from './wechat-payment.gateway';

export interface WeChatNotificationVerifierOptions {
  config: WeChatPayConfig;
  certificates: WeChatCertificateProvider;
  now?: () => Date;
  /** Replay window of a notification signature (`specs/13` §Security). */
  maxAgeSeconds?: number;
}

interface NotificationEnvelope {
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  };
}

interface DecryptedNotification {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  amount?: { total?: number };
}

const DEFAULT_MAX_AGE_SECONDS = 5 * 60;

/**
 * Verification of an official WeChat Pay v3 notification.
 *
 * Steps 10–11 of `specs/08-payment-and-settlement.md` §Create payment: check the
 * signature against the platform certificate the serial points at, then decrypt
 * the payload with the APIv3 key. A stale timestamp is rejected, so a captured
 * notification cannot be replayed later.
 */
export class WeChatNotificationVerifier implements PaymentNotificationVerifier {
  private readonly now: () => Date;
  private readonly maxAgeSeconds: number;

  constructor(private readonly options: WeChatNotificationVerifierOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  }

  async verify(input: {
    headers: NotificationHeaders;
    body: string;
  }): Promise<VerifiedNotification> {
    const serial = header(input.headers, 'wechatpay-serial');
    const signature = header(input.headers, 'wechatpay-signature');
    const timestamp = header(input.headers, 'wechatpay-timestamp');
    const nonce = header(input.headers, 'wechatpay-nonce');

    if (!serial || !signature || !timestamp || !nonce) {
      throw paymentCallbackInvalid('The notification is missing its signature headers.');
    }

    const signedAt = Number(timestamp);
    if (!Number.isFinite(signedAt)) {
      throw paymentCallbackInvalid('The notification carries an invalid timestamp.');
    }
    if (Math.abs(Math.floor(this.now().getTime() / 1000) - signedAt) > this.maxAgeSeconds) {
      throw paymentCallbackInvalid('The notification signature has expired.');
    }

    const certificate = await this.options.certificates.getCertificate(serial);
    if (!certificate) {
      throw paymentCallbackInvalid('The notification was signed with an unknown certificate.');
    }

    // The signed message is timestamp, nonce and the exact raw body.
    const message = `${timestamp}\n${nonce}\n${input.body}\n`;
    if (!verifyRsaSha256(message, signature, certificate)) {
      throw paymentCallbackInvalid('The notification signature is invalid.');
    }

    return this.decrypt(input.body);
  }

  private decrypt(body: string): VerifiedNotification {
    let envelope: NotificationEnvelope;
    try {
      envelope = JSON.parse(body) as NotificationEnvelope;
    } catch {
      throw paymentCallbackInvalid('The notification body is not JSON.');
    }

    const resource = envelope.resource;
    if (resource?.algorithm !== 'AEAD_AES_256_GCM' || !resource.ciphertext || !resource.nonce) {
      throw paymentCallbackInvalid('The notification carries no decryptable resource.');
    }

    let decrypted: DecryptedNotification;
    try {
      const plaintext = decryptResource(
        {
          ciphertext: resource.ciphertext,
          nonce: resource.nonce,
          associatedData: resource.associated_data ?? '',
        },
        this.options.config.apiV3Key,
      );
      decrypted = JSON.parse(plaintext) as DecryptedNotification;
    } catch (error) {
      if (error && (error as { code?: string }).code === 'PAYMENT_CALLBACK_INVALID') {
        throw error;
      }
      throw paymentCallbackInvalid('The notification payload could not be decrypted.');
    }

    if (!decrypted.out_trade_no) {
      throw paymentCallbackInvalid('The notification carries no order number.');
    }

    return {
      // The provider transaction id the platform stored at session creation.
      orderNo: decrypted.out_trade_no,
      providerTransactionId: decrypted.out_trade_no,
      amountMinor: decrypted.amount?.total ?? 0,
      status: mapTradeState(decrypted.trade_state),
      rawRef: null,
    };
  }
}

function header(headers: NotificationHeaders, name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value && value.length > 0 ? value : null;
}
