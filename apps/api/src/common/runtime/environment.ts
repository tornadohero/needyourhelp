/**
 * Runtime environment helpers.
 *
 * Mock adapters of external providers must never become production code paths
 * (`AGENTS.md` §15: do not create fake production integrations). The rule is
 * shared so every mock adapter fails the same way.
 */

/** Environments where a mock adapter may be used. Production is excluded. */
export const MOCK_ALLOWED_ENVIRONMENTS = ['local', 'development', 'test'] as const;

export function isMockAdapterAllowed(environment: string | undefined): boolean {
  const normalized = (environment ?? 'local').toLowerCase();
  return (MOCK_ALLOWED_ENVIRONMENTS as readonly string[]).includes(normalized);
}
