import { ENDPOINTS, apiPath } from '@mentor/api-contracts';

/** Base URL of the modular monolith API; overridable per environment. */
export function resolveApiBaseUrl(configured?: string): string {
  return configured ?? 'http://localhost:3000';
}

export function healthEndpointUrl(apiBaseUrl = resolveApiBaseUrl()): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}${apiPath(ENDPOINTS.health)}`;
}
