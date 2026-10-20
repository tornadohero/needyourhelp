/**
 * Error code → what a screen should do (`api-contract-map.md` §0).
 *
 * The mapping is exhaustive over the codes the platform emits, and unknown codes
 * fall back to a generic message instead of leaking the server's wording.
 */

export type ErrorAction =
  | 'relogin' // session gone: log in again
  | 'forbidden' // authenticated, not permitted
  | 'notfound' // absent, or not visible to this account
  | 'conflict' // state machine refused it: refresh and show again
  | 'form' // the input is wrong
  | 'retry' // transient: offer a retry
  | 'unexpected';

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '登录已失效，请重新登录。',
  FORBIDDEN: '你没有权限进行此操作。',
  NOT_FOUND: '内容不存在或不可见。',
  VALIDATION_ERROR: '提交的信息有误，请检查后重试。',
  PROVIDER_NOT_APPROVED: '该导师尚未通过审核。',
  SERVICE_NOT_PUBLISHED: '该服务未发布。',
  ORDER_NOT_PAYABLE: '该订单当前不可支付。',
  ORDER_INVALID_STATE: '订单状态已变化，请刷新后重试。',
  PAYMENT_FAILED: '支付未完成，请重试或更换支付方式。',
  PAYMENT_CALLBACK_INVALID: '支付结果校验未通过。',
  REFUND_NOT_ALLOWED: '该订单不能退款或退款金额超限。',
  REVIEW_NOT_ELIGIBLE: '只有已完成的订单可以评价，且每单一次。',
  BLOCKED_USER: '对方已屏蔽会话。',
  CONSENT_REQUIRED: '需要先完成监护人授权。',
  CHILD_ACCESS_DENIED: '你没有访问该儿童信息的权限。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  IDEMPOTENCY_CONFLICT: '请求已变更，请重新提交。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
  TRANSPORT_ERROR: '网络连接失败，请检查网络后重试。',
};

const ACTIONS: Record<string, ErrorAction> = {
  AUTH_REQUIRED: 'relogin',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notfound',
  VALIDATION_ERROR: 'form',
  PROVIDER_NOT_APPROVED: 'conflict',
  SERVICE_NOT_PUBLISHED: 'conflict',
  ORDER_NOT_PAYABLE: 'conflict',
  ORDER_INVALID_STATE: 'conflict',
  PAYMENT_FAILED: 'retry',
  PAYMENT_CALLBACK_INVALID: 'retry',
  REFUND_NOT_ALLOWED: 'conflict',
  REVIEW_NOT_ELIGIBLE: 'conflict',
  BLOCKED_USER: 'forbidden',
  CONSENT_REQUIRED: 'forbidden',
  CHILD_ACCESS_DENIED: 'forbidden',
  RATE_LIMITED: 'retry',
  IDEMPOTENCY_CONFLICT: 'retry',
  INTERNAL_ERROR: 'retry',
  TRANSPORT_ERROR: 'retry',
};

export const ERROR_CODES = Object.keys(MESSAGES);

export function messageFor(code: string): string {
  return MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR!;
}

export function actionFor(code: string): ErrorAction {
  return ACTIONS[code] ?? 'unexpected';
}

/**
 * Turn anything thrown into a message a screen can show.
 *
 * Unknown failures are answered with the generic text: a screen must never echo
 * a server message, and it must never show a stack trace.
 */
export function errorMessageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return messageFor(String((error as { code: unknown }).code));
  }
  return messageFor('TRANSPORT_ERROR');
}
