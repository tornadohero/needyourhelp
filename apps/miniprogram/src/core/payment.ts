import type {
  PaymentProviderName,
  PaymentSessionResponse,
  PaymentStatusName,
  PaymentStatusResponse,
} from '@mentor/api-contracts';

import { formatDateTime, formatMoney } from './format';

/**
 * Payment view models (T035b / FE-35).
 *
 * One rule dominates this file: **the server decides whether an order is paid**.
 * The WeChat client callback is a hint, the notification and the provider query
 * are the truth (`specs/08-payment-and-settlement.md`: "Server confirms through
 * payment notification/query"). So the screen never shows "paid" because
 * `wx.requestPayment` resolved — it shows what `GET /orders/:id/payment-status`
 * says.
 */
export const PAYMENT_STATUS_TEXTS: Record<PaymentStatusName, string> = {
  INITIATED: '已发起支付',
  PENDING: '等待支付结果',
  SUCCEEDED: '支付成功',
  FAILED: '支付失败',
  CLOSED: '支付已关闭',
};

export const PROVIDER_TEXTS: Record<PaymentProviderName, string> = {
  WECHAT: '微信支付',
  MOCK: '本地模拟支付',
};

export type PaymentOutcome = 'paid' | 'pending' | 'failed';

export interface PaymentSessionView {
  paymentId: string;
  orderId: string;
  orderNo: string;
  provider: PaymentProviderName;
  providerText: string;
  amountText: string;
  statusText: string;
  /** `true` when the platform returned the session it already had. */
  reused: boolean;
  createdText: string;
  /** `true` for the local adapter: a real `wx.requestPayment` cannot succeed. */
  isMock: boolean;
}

export function describePaymentSession(session: PaymentSessionResponse): PaymentSessionView {
  return {
    paymentId: session.paymentId,
    orderId: session.orderId,
    orderNo: session.orderNo,
    provider: session.provider,
    providerText: PROVIDER_TEXTS[session.provider],
    // The amount is the server's: the client never recomputes it.
    amountText: formatMoney(session.amountMinor),
    statusText: PAYMENT_STATUS_TEXTS[session.status],
    reused: session.reused,
    createdText: formatDateTime(session.createdAt),
    isMock: session.provider === 'MOCK',
  };
}

export interface PaymentStatusView {
  orderId: string;
  orderStatus: string;
  amountText: string;
  paymentText: string;
  outcome: PaymentOutcome;
  paidText: string;
}

export function describePaymentStatus(status: PaymentStatusResponse): PaymentStatusView {
  const payment = status.payment;
  const paymentStatus = payment?.status ?? 'PENDING';

  return {
    orderId: status.orderId,
    orderStatus: status.orderStatus,
    amountText: formatMoney(status.amountMinor),
    paymentText: payment === null ? '还没有支付记录' : PAYMENT_STATUS_TEXTS[paymentStatus],
    outcome: outcomeOf(paymentStatus),
    paidText: payment?.paidAt ? formatDateTime(payment.paidAt) : '',
  };
}

export function outcomeOf(paymentStatus: PaymentStatusName): PaymentOutcome {
  if (paymentStatus === 'SUCCEEDED') {
    return 'paid';
  }
  if (paymentStatus === 'FAILED' || paymentStatus === 'CLOSED') {
    return 'failed';
  }
  return 'pending';
}

/**
 * `wx.requestPayment` needs five fields and nothing else.
 *
 * The platform passes the provider's own `params` through untouched, so they are
 * narrowed here instead of being invented: a missing signature means the client
 * cannot pay in-app, and the screen falls back to "ask the server" rather than
 * calling WeChat with a half-built request.
 */
export interface WechatPaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  /** The signature is what makes the cashier trustworthy: without it there is
   * no in-app payment, only "ask the server what happened". */
  paySign: string;
  signType?: 'MD5' | 'HMAC-SHA256' | 'RSA';
}

export function wechatPaymentParams(params: Record<string, unknown>): WechatPaymentParams | null {
  const { timeStamp, nonceStr, package: packageValue, paySign } = params;

  if (
    typeof timeStamp !== 'string' ||
    typeof nonceStr !== 'string' ||
    typeof packageValue !== 'string' ||
    typeof paySign !== 'string' ||
    paySign.length === 0
  ) {
    return null;
  }

  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    paySign,
    ...(isSignType(params.signType) ? { signType: params.signType } : {}),
  };
}

function isSignType(value: unknown): value is 'MD5' | 'HMAC-SHA256' | 'RSA' {
  return value === 'MD5' || value === 'HMAC-SHA256' || value === 'RSA';
}
