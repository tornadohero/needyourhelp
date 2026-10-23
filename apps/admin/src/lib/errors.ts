/**
 * Error code → what the console does (T033).
 *
 * An operator needs to know **why** an action was refused, so the platform's own
 * error codes are mapped to a sentence and to an action. Unknown codes fall back
 * to a generic message: the console never echoes the server's wording, and it
 * never shows a stack trace (`AGENTS.md` §6).
 */

export type ErrorAction =
  | 'relogin' // the session is gone: send the operator back to login
  | 'forbidden' // authenticated, not permitted for this resource
  | 'notfound'
  | 'conflict' // the state moved on: reload and show the truth
  | 'form' // the input is wrong
  | 'retry'
  | 'unexpected';

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: '登录已失效，请重新登录。',
  FORBIDDEN: '你没有执行该操作的权限。',
  NOT_FOUND: '对象不存在或不可见。',
  VALIDATION_ERROR: '提交的信息有误，请检查后重试。',
  PROVIDER_NOT_APPROVED: '该商家尚未通过审核。',
  SERVICE_NOT_PUBLISHED: '该服务未发布。',
  ORDER_NOT_PAYABLE: '该订单当前不可支付。',
  ORDER_INVALID_STATE: '订单状态已变化，请刷新后重试。',
  PAYMENT_FAILED: '支付未完成。',
  PAYMENT_CALLBACK_INVALID: '支付结果校验未通过。',
  REFUND_NOT_ALLOWED: '该订单不能退款或退款金额超限。',
  REVIEW_NOT_ELIGIBLE: '只有已完成的订单可以评价。',
  BLOCKED_USER: '对方已屏蔽会话。',
  CONSENT_REQUIRED: '需要先完成监护人授权。',
  CHILD_ACCESS_DENIED: '你没有访问该儿童信息的权限。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  IDEMPOTENCY_CONFLICT: '该请求已用不同的内容提交过，请重新确认后提交。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
  TRANSPORT_ERROR: '无法连接到 API，请检查网络或 API 地址。',
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
  IDEMPOTENCY_CONFLICT: 'form',
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
