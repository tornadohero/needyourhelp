import { WeChatProviderUnavailableError } from '../domain/auth-errors';
import type {
  WeChatAuthProvider,
  WeChatCodeExchangeInput,
  WeChatIdentity,
} from '../domain/wechat-auth.provider';

export interface WeChatHttpAuthProviderOptions {
  appId: string;
  appSecret: string;
  /** Overridable for tests/local stubs. Defaults to the official endpoint. */
  endpoint?: string;
  timeoutMs?: number;
}

interface Code2SessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * Real WeChat `code2Session` adapter.
 *
 * Credentials come from configuration/secret manager only and are never logged
 * (`AGENTS.md` §9, `specs/13-security-spec.md` §Secrets).
 *
 * Endpoint: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */
export class WeChatHttpAuthProvider implements WeChatAuthProvider {
  readonly name = 'wechat';

  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: WeChatHttpAuthProviderOptions) {
    this.endpoint = options.endpoint ?? 'https://api.weixin.qq.com/sns/jscode2session';
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async exchangeCode(input: WeChatCodeExchangeInput): Promise<WeChatIdentity> {
    if (!this.options.appId || !this.options.appSecret) {
      throw new WeChatProviderUnavailableError('WeChat credentials are not configured.');
    }

    const url = new URL(this.endpoint);
    url.searchParams.set('appid', this.options.appId);
    url.searchParams.set('secret', this.options.appSecret);
    url.searchParams.set('js_code', input.code);
    url.searchParams.set('grant_type', 'authorization_code');

    let payload: Code2SessionResponse;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      payload = (await response.json()) as Code2SessionResponse;
    } catch {
      // Never include the request URL: it carries the app secret.
      throw new WeChatProviderUnavailableError('WeChat auth provider is unavailable.');
    }

    if (!payload.openid || typeof payload.errcode === 'number') {
      throw new WeChatProviderUnavailableError('WeChat rejected the login code.');
    }

    return { openid: payload.openid, unionid: payload.unionid ?? null };
  }
}
