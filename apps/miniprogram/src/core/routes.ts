/**
 * The endpoints this client uses (T028).
 *
 * The strings are duplicated from `packages/api-contracts` on purpose: the mini
 * program must not carry a runtime dependency (WeChat DevTools would need an npm
 * build, and a symlinked workspace package is fragile there). `routes.test.ts`
 * asserts this map against the contract, so a rename on the server fails the
 * client build instead of failing at runtime.
 */

export const ROUTES = {
  health: '/health',
  healthReady: '/health/ready',

  auth: {
    wechatLogin: '/auth/wechat/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
  },
  me: '/me',
  meProfile: '/me/profile',
  meChildren: '/me/children',
  meConsents: '/me/consents',
  /** Derived from `meConsents`: withdrawal targets one consent type. */
  meConsent: '/me/consents/:consentType',

  providers: '/providers',
  providerDetail: '/providers/:id',
  providerServices: '/providers/:id/services',
  providerReviews: '/providers/:id/reviews',
  providerAvailability: '/providers/:id/availability',
  providerApplications: '/providers/applications',
  providerMe: '/providers/me',
  providerSubmit: '/providers/me/submit',
  providerMyServices: '/providers/me/services',
  providerService: '/providers/me/services/:id',
  providerServicePublish: '/providers/me/services/:id/publish',
  providerServiceUnpublish: '/providers/me/services/:id/unpublish',
  providerMyAvailability: '/providers/me/availability',
  providerSlot: '/providers/me/availability/:id',

  conversations: '/conversations',
  conversationDetail: '/conversations/:id',
  conversationMessages: '/conversations/:id/messages',
  block: '/users/:id/block',

  orders: '/orders',
  orderDetail: '/orders/:id',
  orderCancel: '/orders/:id/cancel',
  orderConfirm: '/orders/:id/confirm',
  orderStart: '/orders/:id/start',
  orderComplete: '/orders/:id/complete',
  paymentSession: '/orders/:id/payment-session',
  paymentStatus: '/orders/:id/payment-status',
  paymentNotify: '/payments/wechat/notify',

  orderRefundRequest: '/orders/:id/refund-request',
  orderRefunds: '/orders/:id/refunds',
  orderReviews: '/orders/:id/reviews',

  reports: '/reports',
  myReports: '/me/reports',
  reportAppeal: '/reports/:id/appeal',

  verificationCases: '/verification/cases',
  verificationCaseDocuments: '/verification/cases/:id/documents/upload-url',
  verificationCaseSubmit: '/verification/cases/:id/submit',
  verificationMe: '/verification/me',
} as const;

/**
 * Replace `:name` placeholders.
 *
 * A leftover placeholder is a bug, not a URL: it is refused rather than sent —
 * otherwise the client would quietly call `/orders/:id`.
 */
export function fillPath(path: string, params: Record<string, string> = {}): string {
  let filled = path;
  for (const [name, value] of Object.entries(params)) {
    filled = filled.replace(`:${name}`, encodeURIComponent(value));
  }
  if (filled.includes(':')) {
    throw new Error(`Unfilled parameter in route ${path}`);
  }
  return filled;
}

/** Query string, skipping undefined values; never encodes a signature or token. */
export function queryString(
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function apiUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  return `${path}${queryString(query)}`;
}
