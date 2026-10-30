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
 * Pick one document from the device.
 *
 * Only metadata comes back: the bytes are read when they are uploaded, and a
 * document is never written to the client's own storage (`specs/10`).
 */
export function chooseDocument(): Promise<{
  path: string;
  size: number;
  mimeType: string;
} | null> {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['original'],
      success: (result: {
        tempFiles?: { tempFilePath: string; size: number; fileType?: string }[];
      }) => {
        const file = result.tempFiles?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        resolve({
          path: file.tempFilePath,
          size: file.size,
          mimeType: file.fileType === 'video' ? 'video/mp4' : 'image/jpeg',
        });
      },
      fail: () => resolve(null),
    });
  });
}

/** Read a picked file as bytes: no `encoding` means an ArrayBuffer. */
export function readFileBytes(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (result: { data: ArrayBuffer | string }) =>
        typeof result.data === 'string'
          ? reject(new Error('expected binary file data'))
          : resolve(result.data),
      fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? 'read file failed')),
    });
  });
}

/**
 * `PUT` bytes to the signed object URL.
 *
 * The signed URL is the credential and the headers that came with it are part
 * of it: they are sent exactly as issued, and nothing else is added. This is
 * the only request that leaves the platform's own API.
 */
export function putBinary(
  url: string,
  bytes: ArrayBuffer,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'PUT',
      header: headers,
      data: bytes,
      success: (response: { statusCode: number }) =>
        response.statusCode >= 200 && response.statusCode < 300
          ? resolve()
          : reject(new Error(`upload failed with ${response.statusCode}`)),
      fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg ?? 'upload failed')),
    });
  });
}

/**
 * `wx.requestPayment`: the in-app cashier.
 *
 * The parameters are the provider's own, passed through untouched. What it
 * answers is a **hint**: the platform confirms through the notification and the
 * provider query, so a screen shows the server's status, never this result.
 */
export function requestPayment(params: {
  timeStamp: string;
  nonceStr: string;
  package: string;
  paySign: string;
  signType?: 'MD5' | 'HMAC-SHA256' | 'RSA';
}): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    wx.requestPayment({
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      paySign: params.paySign,
      ...(params.signType === undefined ? {} : { signType: params.signType }),
      success: () => resolve({ ok: true, message: '' }),
      fail: (error: { errMsg?: string }) =>
        resolve({ ok: false, message: error.errMsg ?? '支付未完成' }),
    });
  });
}

/**
 * Local storage, for the one thing a screen may remember: what the user was
 * last looking for.
 *
 * It lives here for the same reason the transport does — `wx.*` stays in the
 * adapter — and it carries no personal data, only a filter.
 */
export function readStored<T>(key: string): T | null {
  try {
    const raw = wx.getStorageSync(key);
    return raw === '' || raw === null || raw === undefined ? null : (raw as T);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // A full or disabled storage costs a convenience, never a feature.
  }
}

export function removeStored(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    // Ignored for the same reason.
  }
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
