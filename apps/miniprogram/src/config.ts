import type { MiniProgramEnv } from './core/env';

/**
 * The only file a deployment has to touch (T028).
 *
 * There is deliberately **no secret here**: no merchant id, no API key, no token.
 * Everything that must stay secret lives on the server (`AGENTS.md` §9,
 * `specs/13-security-spec.md`). If a value here ever needs hiding, the design is
 * wrong — move it behind the API.
 */
export const config: {
  env: MiniProgramEnv;
  /** API origin. Empty means "use the local default" and is refused in release. */
  apiOrigin: string;
} = {
  // Local development against `pnpm --filter @mentor/api start:prod`.
  env: 'develop',
  apiOrigin: '',
};
