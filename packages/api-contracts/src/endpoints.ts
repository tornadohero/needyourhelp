/** REST base path. Architecture spec: base `/api/v1`. */
export const API_BASE = '/api/v1' as const;

/** Header carrying the client-supplied idempotency key (architecture spec §Idempotency). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key' as const;

/** Header echoed back on every response for log correlation. */
export const REQUEST_ID_HEADER = 'X-Request-Id' as const;

export const ENDPOINTS = {
  health: '/health',
  consoleLogin: '/auth/console/login',
  adminConsoleCredentials: '/admin/console-credentials',
  conversationMessages: '/conversations/:id/messages',
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
  providers: '/providers',
  providerApplications: '/providers/applications',
  providerMe: '/providers/me',
  providerSubmit: '/providers/me/submit',
  providerServices: '/providers/me/services',
  providerAvailability: '/providers/me/availability',
  conversations: '/conversations',
  orders: '/orders',
  paymentSession: '/orders/:id/payment-session',
  paymentStatus: '/orders/:id/payment-status',
  paymentNotify: '/payments/wechat/notify',
  orderRefundRequest: '/orders/:id/refund-request',
  orderRefunds: '/orders/:id/refunds',
  adminOrderRefund: '/admin/orders/:id/refund',
  orderReviews: '/orders/:id/reviews',
  providerReviews: '/providers/:id/reviews',
  reports: '/reports',
  myReports: '/me/reports',
  reportAppeal: '/reports/:id/appeal',
  adminDashboard: '/admin/dashboard',
  adminUsers: '/admin/users',
  adminUserRoles: '/admin/users/:id/roles',
  adminProviders: '/admin/providers',
  adminProviderSuspend: '/admin/providers/:id/suspend',
  adminProviderRestore: '/admin/providers/:id/restore',
  adminOrders: '/admin/orders',
  adminAuditLogs: '/admin/audit-logs',
  adminFeatureFlags: '/admin/feature-flags',
  adminFeatureFlag: '/admin/feature-flags/:key',
  adminPlatformRules: '/admin/platform-rules',
  adminPlatformRulePublish: '/admin/platform-rules/:id/publish',
  adminReports: '/admin/reports',
  adminReportResolve: '/admin/reports/:id/resolve',
  adminCaseTransition: '/admin/moderation/:id/transition',
  adminCaseFinalize: '/admin/moderation/:id/finalize',
  adminCompliance: '/admin/compliance',
  verificationCases: '/verification/cases',
  verificationMe: '/verification/me',
  adminVerifications: '/admin/verifications',
  taxonomy: '/admin/taxonomy',
} as const;

export function apiPath(path: string): string {
  return `${API_BASE}${path}`;
}
