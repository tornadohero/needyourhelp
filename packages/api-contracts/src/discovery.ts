/**
 * Discovery contract (T010).
 *
 * Source of truth: `specs/05-api-spec.md` §Provider (`GET /providers`,
 * `GET /providers/:id`, `GET /providers/:id/services`),
 * `specs/01-business-rules.md` §Provider approval and §Ranking,
 * `specs/07-permission-spec.md` ("User can read public provider profiles"),
 * `specs/10-privacy-and-minors.md` (allowlist DTOs, no private data).
 *
 * These payloads are the public view of a provider: they are built field by
 * field and never carry the account id, any approval/verification/compliance
 * workflow state or any private contact data.
 */

import type { ServiceResponse } from './services';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * `sort` values accepted by `GET /providers`.
 *
 * `specs/05-api-spec.md` names the parameter but not its values; the ordering
 * itself follows `specs/01-business-rules.md` §Ranking, which is a retrieval
 * ordering and never a quality score.
 */
export const PROVIDER_SORTS = ['relevance', 'rating', 'newest'] as const;
export type ProviderSortName = (typeof PROVIDER_SORTS)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** The public half of a capability: what kind of provider and how verified. */
export interface PublicCapabilityResponse {
  capabilityType: string;
  verificationLevel: string;
}

/**
 * A provider as anyone may see it.
 *
 * Deliberately absent (private or workflow state, `specs/07-permission-spec.md`,
 * `specs/10-privacy-and-minors.md`): the owning `userId`, `approvalStatus`,
 * `searchable`, `avatarVisibility`, and every capability field except the type
 * and the verification level — a capability `status`, `complianceStatus` and the
 * `restriction_json` scope are internal.
 */
export interface PublicProviderResponse {
  id: string;
  providerType: string;
  publicName: string;
  headline: string | null;
  bio: string | null;
  /** Null unless the provider made their photo public (`specs/01` §Student tutor). */
  avatarAssetId: string | null;
  cityCode: string | null;
  serviceMode: string;
  ratingAvg: number | null;
  ratingCount: number;
  completedOrderCount: number;
  capabilities: PublicCapabilityResponse[];
  createdAt: string;
}

/** One row of `GET /providers`. */
export interface ProviderSearchItemResponse extends PublicProviderResponse {
  /** Cheapest published service, in minor units; null only if none is published. */
  minPriceMinor: number | null;
}

export interface ProviderSearchResponse {
  items: ProviderSearchItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /providers/:id`: the public profile plus its published services. */
export interface ProviderDetailResponse extends PublicProviderResponse {
  services: ServiceResponse[];
}

/** `GET /providers/:id/services`: published services only. */
export interface PublicProviderServiceListResponse {
  items: ServiceResponse[];
  total: number;
}
