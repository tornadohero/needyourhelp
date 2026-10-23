/**
 * Environment configuration for the admin console (T033).
 *
 * There is exactly one setting — where the API is — and it is read **on the
 * server**. Nothing secret is ever injected into the browser bundle: no API key,
 * no merchant id, no token (`AGENTS.md` §9, `specs/13-security-spec.md`). If a
 * value ever needs hiding here, the design is wrong: move it behind the API.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export function resolveApiBaseUrl(configured?: string): string {
  const raw = configured ?? process.env.ADMIN_API_BASE_URL ?? '';
  const value = raw.trim();
  return value.length > 0 ? value.replace(/\/+$/, '') : DEFAULT_API_BASE_URL;
}

/** `true` when the console talks to the API over TLS or a loopback address. */
export function isTrustedApiBaseUrl(apiBaseUrl: string): boolean {
  return (
    apiBaseUrl.startsWith('https://') ||
    apiBaseUrl.includes('localhost') ||
    apiBaseUrl.includes('127.0.0.1')
  );
}
