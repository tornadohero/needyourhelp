/**
 * WeChat login port.
 *
 * `specs/03-architecture-spec.md` uses adapters/interfaces for every external
 * provider; domain logic must never call a vendor SDK directly (`AGENTS.md` §6).
 */

export interface WeChatIdentity {
  /** Raw openid from `code2session`. Never persisted in clear text. */
  openid: string;
  /** Raw unionid when the app is bound to an open platform account. */
  unionid: string | null;
}

export interface WeChatCodeExchangeInput {
  /** Single-use `wx.login()` code. */
  code: string;
}

export const WECHAT_AUTH_PROVIDER = 'WECHAT_AUTH_PROVIDER';

export interface WeChatAuthProvider {
  /** Human-readable adapter name, used for audit/logging (never secrets). */
  readonly name: string;

  exchangeCode(input: WeChatCodeExchangeInput): Promise<WeChatIdentity>;
}
