import type { HttpMethod, Transport, TransportRequest, TransportResponse } from '../core/http';
import type { SessionTokens, TokenStore } from '../core/session';

/**
 * The WeChat platform adapter (T028).
 *
 * Everything that touches `wx.*` lives here and nowhere else: the core stays
 * testable in Node, and swapping the transport for a test double is a one-liner.
 */

const STORAGE_KEY = 'mentor.session';

/** `wx.request` as a {@link Transport}. */
export function createWechatTransport(): Transport {
  return (request: TransportRequest): Promise<TransportResponse> =>
    new Promise((resolve, reject) => {
      wx.request({
        url: request.url,
        method: toWechatMethod(request.method),
        header: request.headers,
        ...(request.body === undefined ? {} : { data: request.body }),
        timeout: request.timeoutMs,
        // WeChat answers with the parsed JSON body and the HTTP status.
        success: (response: { statusCode: number; data: unknown }) =>
          resolve({ status: response.statusCode, body: response.data }),
        fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? 'request failed')),
      });
    });
}

/** `wx.login()`: the only way a mini program proves a session to its own server. */
export function fetchLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result: { code?: string }) =>
        result.code ? resolve(result.code) : reject(new Error('wx.login returned no code')),
      fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? 'wx.login failed')),
    });
  });
}

/**
 * Session storage.
 *
 * WeChat storage is per-mini-program and unencrypted, so only the opaque refresh
 * token and the short-lived access token are kept — never a password, never a
 * child profile, never a document URL (`specs/10-privacy-and-minors.md`).
 */
export function createWechatTokenStore(): TokenStore {
  return {
    get(): SessionTokens | null {
      try {
        const raw = wx.getStorageSync(STORAGE_KEY);
        if (typeof raw !== 'string' || raw.length === 0) {
          return null;
        }
        const parsed = JSON.parse(raw) as Partial<SessionTokens>;
        if (!parsed.accessToken || !parsed.refreshToken) {
          return null;
        }
        return {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          ...(typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : {}),
        };
      } catch {
        // Corrupted storage is treated as "not signed in", never as a crash.
        return null;
      }
    },
    set(tokens: SessionTokens): void {
      wx.setStorageSync(STORAGE_KEY, JSON.stringify(tokens));
    },
    clear(): void {
      wx.removeStorageSync(STORAGE_KEY);
    },
  };
}

/**
 * Navigation and feedback.
 *
 * They live here for the same reason the transport does: a page that calls `wx`
 * directly cannot be reasoned about (or moved) without the platform.
 */

export function navigateTo(url: string): void {
  wx.navigateTo({ url });
}

export function redirectTo(url: string): void {
  wx.redirectTo({ url });
}

/** A short message. `icon: 'none'` keeps a failure from looking like a success. */
export function showToast(title: string): void {
  wx.showToast({ title, icon: 'none' });
}

/**
 * A yes/no question, for the two actions that cannot be undone: cancelling a
 * booking and asking for a refund.
 */
export function confirm(options: { title: string; content: string }): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      success: (result: { confirm?: boolean }) => resolve(result.confirm === true),
      fail: () => resolve(false),
    });
  });
}

/**
 * `wx.request` has no PATCH.
 *
 * The client refuses rather than silently downgrading to POST: a write that
 * changes meaning in transit is worse than a failed call. No screen needs PATCH
 * today (`api-contract-map.md`), so the gap is visible instead of hidden.
 */
function toWechatMethod(
  method: HttpMethod,
): 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE' | 'CONNECT' {
  if (method === 'PATCH') {
    throw new Error('wx.request does not support PATCH; the API must expose another verb.');
  }
  return method;
}
