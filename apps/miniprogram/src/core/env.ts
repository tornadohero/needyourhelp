/**
 * Environment configuration (T028).
 *
 * The mini program has exactly **one** configuration value: where the API is.
 * There is no key, secret, merchant id or token here — those live on the server
 * (`AGENTS.md` §9, `specs/13-security-spec.md`). A client that shipped one would
 * not be a secret any more.
 */

export type MiniProgramEnv = 'develop' | 'trial' | 'release';

/** API base path, identical to the one the contract ships. */
export const API_BASE = '/api/v1';

export const DEFAULT_API_ORIGIN: Record<MiniProgramEnv, string | null> = {
  // Local development: the modular monolith on the developer's machine.
  develop: 'http://localhost:3000',
  trial: null,
  release: null,
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Resolve the API origin.
 *
 * - `develop` falls back to localhost so a fresh clone works out of the box;
 * - `trial` and `release` must be configured explicitly, and must be HTTPS:
 *   guessing an origin is how a client ends up talking to the wrong server.
 */
export function resolveApiOrigin(
  options: { configured?: string; env?: MiniProgramEnv } = {},
): string {
  const env: MiniProgramEnv = options.env ?? 'release';
  const configured = (options.configured ?? '').trim().replace(/\/+$/, '');

  if (configured.length > 0) {
    if (env !== 'develop' && !configured.startsWith('https://')) {
      throw new ConfigurationError(`The API origin must be HTTPS in ${env}: ${configured}`);
    }
    return configured;
  }

  const fallback = DEFAULT_API_ORIGIN[env];
  if (!fallback) {
    throw new ConfigurationError(
      `No API origin is configured for the ${env} environment. Set apiOrigin in src/config.ts.`,
    );
  }
  return fallback;
}
