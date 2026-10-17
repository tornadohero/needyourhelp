import type {
  CapabilityType,
  DeliveryMode,
  ProviderCapability,
  ProviderProfile,
  ProviderType,
} from '../../provider/domain/provider-profile.model';
import type { Service } from '../../services/domain/service.model';

/**
 * The discovery read model (`specs/05-api-spec.md` §Provider).
 *
 * Discovery is read-only: it never writes and never decides state. It reads the
 * provider, capability, service and taxonomy rows through one port
 * ({@link ProviderDirectory}), the same way the readiness gates of T006/T009
 * read the state they do not own.
 */

/**
 * `sort` of `GET /providers`.
 *
 * `specs/01-business-rules.md` §Ranking defines the V1 ordering; it is a
 * retrieval ordering, never a quality score.
 */
export type ProviderSort = 'relevance' | 'rating' | 'newest';

export interface ProviderSearchQuery {
  /** Marketplace: `provider_profiles.provider_type` (`TUTORING|CAREER`). */
  domain: ProviderType;
  cityCode?: string | null;
  /** Kind of provider: `provider_capabilities.capability_type`. */
  capabilityType?: CapabilityType | null;
  subjectCode?: string | null;
  gradeCode?: string | null;
  deliveryMode?: DeliveryMode | null;
  /** Minor units; the filters bound the price of a published service. */
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
  verifiedOnly: boolean;
  page: number;
  pageSize: number;
  sort: ProviderSort;
}

/** One provider, as the list shows it. */
export interface ProviderSearchHit {
  provider: ProviderProfile;
  capabilities: ProviderCapability[];
  /** Cheapest published service in minor units; `null` only if none is published. */
  minPriceMinor: number | null;
}

export interface ProviderSearchPage {
  hits: ProviderSearchHit[];
  total: number;
}

/** A page plus the paging that produced it, for the response envelope. */
export interface ProviderSearchResult extends ProviderSearchPage {
  page: number;
  pageSize: number;
}

/**
 * A discoverable provider with everything the public detail page shows.
 *
 * `services` holds published services only: a draft is never public
 * (`specs/06-verification-state-machine.md` §Service publication).
 */
export interface ProviderDetail {
  provider: ProviderProfile;
  capabilities: ProviderCapability[];
  services: Service[];
}
