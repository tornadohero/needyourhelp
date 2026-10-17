/**
 * Service contract (T009).
 *
 * Source of truth: `specs/05-api-spec.md` §Services,
 * `specs/04-database-spec.md` (§services / §service_terms),
 * `specs/06-verification-state-machine.md` §Service publication,
 * `specs/01-business-rules.md` §Service ("Price is server authoritative") and
 * `specs/02-domain-model.md` §Service aggregate.
 *
 * Every payload is an allowlist: ORM entities are never serialized
 * (`AGENTS.md` §10).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * `services.status` — `specs/06-verification-state-machine.md` §Service
 * publication.
 */
export const SERVICE_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'UNPUBLISHED',
] as const;
export type ServiceStatusName = (typeof SERVICE_STATUSES)[number];

/** `services.domain` — mirrors `provider_profiles.provider_type`. */
export const SERVICE_DOMAINS = ['TUTORING', 'CAREER'] as const;
export type ServiceDomainName = (typeof SERVICE_DOMAINS)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * A resolved taxonomy tag of a service (`service_terms`).
 *
 * Terms are exposed with their stable code: that is what discovery (T010),
 * teacher compliance scopes (T007) and order snapshots compare against.
 */
export interface ServiceTermResponse {
  termId: string;
  type: string;
  code: string;
  name: string;
}

/**
 * A provider service.
 *
 * `cancellationPolicyId` is deliberately absent: refund policy is configured
 * elsewhere (T016) and an internal policy id is meaningless to a client.
 */
export interface ServiceResponse {
  id: string;
  providerId: string;
  domain: ServiceDomainName;
  title: string;
  description: string | null;
  durationMinutes: number;
  /** Integer minor units: money is never a float (`AGENTS.md` §8). */
  priceMinor: number;
  currency: string;
  deliveryMode: string;
  status: ServiceStatusName;
  terms: ServiceTermResponse[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /providers/me/services`. */
export interface ProviderServiceListResponse {
  items: ServiceResponse[];
  total: number;
}
