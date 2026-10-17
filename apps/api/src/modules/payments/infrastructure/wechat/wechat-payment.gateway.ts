import {
  buildAuthorizationHeader,
  buildJsapiPaymentParams,
  createNonce,
  toOutTradeNo,
} from './wechat-pay-crypto';
import type { WeChatPayConfig } from './wechat-pay-config';
import type { WeChatCertificateProvider } from './wechat-certificate.provider';
import type {
  CreatePaymentInput,
  PaymentGateway,
  PaymentQueryResult,
  PaymentSession,
  RefundInput,
  RefundResult,
} from '../../domain/payment-gateway';

export interface WeChatPaymentGatewayOptions {
  config: WeChatPayConfig;
  certificates: WeChatCertificateProvider;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface PrepayResponse {
  prepay_id?: string;
  code?: string;
  message?: string;
}

interface QueryResponse {
  trade_state?: string;
  transaction_id?: string;
  out_trade_no?: string;
  success_time?: string;
  amount?: { total?: number; currency?: string };
}

interface RefundResponse {
  refund_id?: string;
  status?: string;
}

/**
 * The official WeChat Pay v3 adapter (`specs/03-architecture-spec.md`
 * §External provider ports, `specs/08-payment-and-settlement.md`).
 *
 * - JSAPI prepay: `POST /v3/pay/transactions/jsapi`
 * - query: `GET /v3/pay/transactions/out-trade-no/{out_trade_no}`
 * - refund: `POST /v3/refund/domestic/refunds`
 *
 * Documentation:
 * - https://pay.wechatpay.cn/doc/v3/merchant/4012791911
 * - https://pay.wechatpay.cn/doc/v3/merchant/4015459512
 *
 * Credentials live in {@link WeChatPayConfig} only: nothing here reads a secret
 * from anywhere else, and no request, response or error message ever contains
 * one (`specs/13-security-spec.md` §Secrets, §Logging).
 */
export class WeChatPaymentGateway implements PaymentGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: WeChatPaymentGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async createMiniProgramPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    if (input.currency !== 'CNY') {
      throw new Error(`WeChat Pay cannot charge ${input.currency}; only CNY is supported.`);
    }
    // The JSAPI flow is per-payer: WeChat needs the openid that will pay.
    if (!input.payerOpenId) {
      throw new Error(
        'A WeChat JSAPI payment needs the payer openid; see the T015 note in implementation/progress.md.',
      );
    }

    const outTradeNo = toOutTradeNo(input.orderNo);
    const url = '/v3/pay/transactions/jsapi';
    const body = JSON.stringify({
      appid: this.options.config.appId,
      mchid: this.options.config.merchantId,
      description: input.description.slice(0, 127),
      out_trade_no: outTradeNo,
      notify_url: this.options.config.notifyUrl,
      amount: { total: input.amountMinor, currency: 'CNY' },
      payer: { openid: input.payerOpenId },
    });

    const payload = await this.request<PrepayResponse>('POST', url, body);

    if (!payload.prepay_id) {
      throw new Error('WeChat Pay did not return a prepay id.');
    }

    const timeStamp = Math.floor(this.now().getTime() / 1000);
    const nonceStr = createNonce();

    return {
      // The platform keeps its own id: notifications and queries are keyed by it.
      providerTransactionId: outTradeNo,
      prepayReference: payload.prepay_id,
      params: buildJsapiPaymentParams({
        appId: this.options.config.appId,
        timeStamp,
        nonceStr,
        prepayId: payload.prepay_id,
        privateKeyPem: this.options.config.privateKeyPem,
      }),
    };
  }

  /**
   * Server-side confirmation.
   *
   * This is the authoritative answer: the client's callback is informational
   * only (`specs/08` §Payment invariants).
   */
  async queryPayment(input: { providerTransactionId: string }): Promise<PaymentQueryResult> {
    const outTradeNo = toOutTradeNo(input.providerTransactionId);
    const url = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${this.options.config.merchantId}`;

    const payload = await this.request<QueryResponse>('GET', url, '');

    return {
      providerTransactionId: outTradeNo,
      status: mapTradeState(payload.trade_state),
      amountMinor: payload.amount?.total ?? 0,
      paidAt: payload.success_time ? new Date(payload.success_time) : null,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const outTradeNo = toOutTradeNo(input.providerTransactionId);
    const url = '/v3/refund/domestic/refunds';
    const body = JSON.stringify({
      out_trade_no: outTradeNo,
      out_refund_no: `RF${outTradeNo}`.slice(0, 64),
      reason: input.reason ?? undefined,
      amount: {
        refund: input.amountMinor,
        // The order total is required by the API; the server knows it.
        total: input.amountMinor,
        currency: 'CNY',
      },
    });

    const payload = await this.request<RefundResponse>('POST', url, body);

    return {
      providerRef: payload.refund_id ?? '',
      status: mapRefundStatus(payload.status),
    };
  }

  /** Sign, send and parse one v3 request. */
  private async request<T>(method: 'GET' | 'POST', url: string, body: string): Promise<T> {
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const nonce = createNonce();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.config.baseUrl}${url}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'mentor-platform',
          Authorization: buildAuthorizationHeader({
            method,
            url,
            timestamp,
            nonce,
            body,
            merchantId: this.options.config.merchantId,
            serialNo: this.options.config.merchantSerialNo,
            privateKeyPem: this.options.config.privateKeyPem,
          }),
        },
        ...(method === 'POST' ? { body } : {}),
        signal: AbortSignal.timeout(this.options.config.timeoutMs),
      });
    } catch (error) {
      // Never echo the request: it carries the merchant signature.
      throw new Error(
        `WeChat Pay is unavailable (${error instanceof Error ? error.name : 'error'}).`,
      );
    }

    if (!response.ok) {
      throw new Error(`WeChat Pay rejected the request (status ${response.status}).`);
    }

    return (await response.json()) as T;
  }
}

/** `trade_state` -> the platform's own query status. */
export function mapTradeState(state: string | undefined): PaymentQueryResult['status'] {
  switch (state) {
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'CLOSED':
    case 'REVOKED':
      return 'CLOSED';
    case 'PAYERROR':
      return 'FAILED';
    default:
      // NOTPAY, USER_PAYING, REFUND and anything unknown: still waiting.
      return 'PENDING';
  }
}

function mapRefundStatus(status: string | undefined): RefundResult['status'] {
  switch (status) {
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'ABNORMAL':
      return 'FAILED';
    default:
      return 'REQUESTED';
  }
}
