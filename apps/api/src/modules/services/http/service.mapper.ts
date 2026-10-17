import type {
  ProviderServiceListResponse,
  ServiceResponse,
  ServiceTermResponse,
} from '@mentor/api-contracts';

import type { Service, ServiceTermRef } from '../domain/service.model';

/**
 * Response mappers for provider services.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). Nothing private is exposed: the service carries no internal
 * note, and the cancellation policy id is left out because a policy id is
 * meaningless to a client (T016 owns the policy itself).
 */
export function toServiceTermResponse(term: ServiceTermRef): ServiceTermResponse {
  return {
    termId: term.termId,
    type: term.type,
    code: term.code,
    name: term.name,
  };
}

export function toServiceResponse(service: Service): ServiceResponse {
  return {
    id: service.id,
    providerId: service.providerId,
    domain: service.domain,
    title: service.title,
    description: service.description,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency,
    deliveryMode: service.deliveryMode,
    status: service.status,
    terms: service.terms.map(toServiceTermResponse),
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export function toProviderServiceListResponse(
  services: readonly Service[],
): ProviderServiceListResponse {
  return {
    items: services.map(toServiceResponse),
    total: services.length,
  };
}
