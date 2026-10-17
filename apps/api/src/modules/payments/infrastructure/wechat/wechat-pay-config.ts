import { readFileSync } from 'node:fs';

import type { ConfigService } from '@nestjs/config';

/**
 * WeChat Pay configuration.
 *
 * Secrets come from the environment or a secret manager only, are never written
 * to the database, never returned by an API and never logged
 * (`AGENTS.md` §9, `specs/13-security-spec.md` §Secrets). The adapter refuses to
 * start without them when it is selected in production.
 */
export interface WeChatPayConfig {
  appId: string;
  merchantId: string;
  /** Serial number of the merchant API certificate whose private key is used. */
  merchantSerialNo: string;
  /** PEM of the merchant private key; never leaves memory. */
  privateKeyPem: string;
  /** 32-byte APIv3 key used to decrypt notification payloads. */
  apiV3Key: string;
  /** Absolute URL WeChat calls back on (`/api/v1/payments/wechat/notify`). */
  notifyUrl: string;
  baseUrl: string;
  timeoutMs: number;
}

export const DEFAULT_WECHAT_PAY_BASE_URL = 'https://api.mch.weixin.qq.com';
export const DEFAULT_TIMEOUT_MS = 5_000;

const REQUIRED_KEYS = [
  'WECHAT_PAY_APP_ID',
  'WECHAT_PAY_MCH_ID',
  'WECHAT_PAY_SERIAL_NO',
  'WECHAT_PAY_API_V3_KEY',
  'WECHAT_PAY_NOTIFY_URL',
] as const;

/**
 * Resolve the configuration, or `null` when WeChat Pay is not configured at all.
 *
 * A partial configuration is a deployment error, not something to guess: it
 * throws, so the API fails fast instead of silently falling back to the mock.
 */
export function resolveWeChatPayConfig(
  config: ConfigService,
  environment: string | undefined,
): WeChatPayConfig | null {
  const values = new Map<string, string>();
  for (const key of REQUIRED_KEYS) {
    const value = config.get<string>(key);
    if (value && value.trim().length > 0) {
      values.set(key, value.trim());
    }
  }

  const privateKeyPem = readPrivateKey(config);
  if (privateKeyPem) {
    values.set('WECHAT_PAY_PRIVATE_KEY', privateKeyPem);
  }

  if (values.size === 0) {
    return null;
  }

  // Production must not fall back to plain HTTP anywhere: the notification URL
  // and the API endpoint are both attacked paths.
  if (isProduction(environment)) {
    const notifyUrl = values.get('WECHAT_PAY_NOTIFY_URL') ?? '';
    const baseUrl = config.get<string>('WECHAT_PAY_BASE_URL') ?? DEFAULT_WECHAT_PAY_BASE_URL;
    for (const url of [notifyUrl, baseUrl]) {
      if (!url.startsWith('https://')) {
        throw new Error(`WeChat Pay URLs must be https in production (got ${url}).`);
      }
    }
  }

  const missing = [...REQUIRED_KEYS, 'WECHAT_PAY_PRIVATE_KEY'].filter((key) => !values.has(key));
  if (missing.length > 0) {
    throw new Error(
      `WeChat Pay is partially configured; missing ${missing.join(', ')}. ` +
        'Remove every WECHAT_PAY_* variable to use the mock adapter instead.',
    );
  }

  return {
    appId: values.get('WECHAT_PAY_APP_ID')!,
    merchantId: values.get('WECHAT_PAY_MCH_ID')!,
    merchantSerialNo: values.get('WECHAT_PAY_SERIAL_NO')!,
    privateKeyPem: values.get('WECHAT_PAY_PRIVATE_KEY')!,
    apiV3Key: values.get('WECHAT_PAY_API_V3_KEY')!,
    notifyUrl: values.get('WECHAT_PAY_NOTIFY_URL')!,
    baseUrl: config.get<string>('WECHAT_PAY_BASE_URL') ?? DEFAULT_WECHAT_PAY_BASE_URL,
    timeoutMs: Number(config.get<string>('WECHAT_PAY_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS),
  };
}

/**
 * The merchant private key: inline PEM, or a path to a PEM file.
 *
 * A path is usually the safer option — file permissions are easier to control
 * than environment variables, and inline PEMs end up in process listings.
 */
function readPrivateKey(config: ConfigService): string | null {
  const inline = config.get<string>('WECHAT_PAY_PRIVATE_KEY');
  if (inline && inline.trim().length > 0) {
    // `\n` in an env value is a literal escape in most shells.
    return inline.trim().replace(/\\n/g, '\n');
  }

  const path = config.get<string>('WECHAT_PAY_PRIVATE_KEY_PATH');
  if (path && path.trim().length > 0) {
    return readFileSync(path.trim(), 'utf8');
  }

  return null;
}

function isProduction(environment: string | undefined): boolean {
  return (environment ?? 'local').toLowerCase() === 'production';
}

/** Diagnostics-safe view: names only, never a value (`specs/13` §Logging). */
export function redactWeChatPayConfig(config: WeChatPayConfig): Record<string, string> {
  return {
    appId: mask(config.appId),
    merchantId: mask(config.merchantId),
    merchantSerialNo: mask(config.merchantSerialNo),
    privateKeyPem: '<redacted>',
    apiV3Key: '<redacted>',
    notifyUrl: config.notifyUrl,
    baseUrl: config.baseUrl,
    timeoutMs: String(config.timeoutMs),
  };
}

function mask(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
