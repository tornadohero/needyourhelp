/** REST base path. Architecture spec: base `/api/v1`. */
export const API_BASE = '/api/v1' as const;

/** Header carrying the client-supplied idempotency key (architecture spec §Idempotency). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key' as const;

/** Header echoed back on every response for log correlation. */
export const REQUEST_ID_HEADER = 'X-Request-Id' as const;

export const ENDPOINTS = {
  health: '/health',
  auth: {
    wechatLogin: '/auth/wechat/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
  },
  taxonomy: '/admin/taxonomy',
} as const;

export function apiPath(path: string): string {
  return `${API_BASE}${path}`;
}
