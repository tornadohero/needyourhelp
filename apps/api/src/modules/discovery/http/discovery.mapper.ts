import type {
  ProviderDetailResponse,
  ProviderSearchResponse,
  PublicCapabilityResponse,
  PublicProviderResponse,
  PublicProviderServiceListResponse,
} from '@mentor/api-contracts';

import type {
  ProviderCapability,
  ProviderProfile,
} from '../../provider/domain/provider-profile.model';
import { toServiceResponse } from '../../services/http/service.mapper';
import type { ProviderDetail, ProviderSearchResult } from '../domain/provider-search.model';
import type { Service } from '../../services/domain/service.model';

/**
 * Public response mappers for discovery.
 *
 * Built field by field, never by serializing ORM entities (`AGENTS.md` §10,
 * `specs/10-privacy-and-minors.md`). What a caller must never see — and what
 * therefore has no place in these payloads:
 *
 * - the owning account (`userId`);
 * - workflow state: `approvalStatus`, `searchable`, capability `status`,
 *   `complianceStatus` and the `restriction_json` scope of a restricted teacher
 *   (T007);
 * - the visibility setting itself: a private photo is simply absent;
 * - anything else private: no contact data, no identity document, no child data
 *   is ever read here.
 */
export function toPublicCapabilityResponse(
  capability: ProviderCapability,
): PublicCapabilityResponse {
  return {
    capabilityType: capability.capabilityType,
    verificationLevel: capability.verificationLevel,
  };
}

export function toPublicProviderResponse(
  profile: ProviderProfile,
  capabilities: readonly ProviderCapability[],
): PublicProviderResponse {
  return {
    id: profile.id,
    providerType: profile.providerType,
    publicName: profile.publicName,
    headline: profile.headline,
    bio: profile.bio,
    // A private photo is never published (`specs/01-business-rules.md` §Student tutor).
    avatarAssetId: profile.avatarVisibility === 'PUBLIC' ? profile.avatarAssetId : null,
    cityCode: profile.cityCode,
    serviceMode: profile.serviceMode,
    ratingAvg: profile.ratingAvg,
    ratingCount: profile.ratingCount,
    completedOrderCount: profile.completedOrderCount,
    capabilities: capabilities.map(toPublicCapabilityResponse),
    createdAt: profile.createdAt.toISOString(),
  };
}

export function toProviderSearchResponse(result: ProviderSearchResult): ProviderSearchResponse {
  return {
    items: result.hits.map((hit) => ({
      ...toPublicProviderResponse(hit.provider, hit.capabilities),
      minPriceMinor: hit.minPriceMinor,
    })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

export function toProviderDetailResponse(detail: ProviderDetail): ProviderDetailResponse {
  return {
    ...toPublicProviderResponse(detail.provider, detail.capabilities),
    services: detail.services.map(toServiceResponse),
  };
}

export function toPublicProviderServiceListResponse(
  services: readonly Service[],
): PublicProviderServiceListResponse {
  return {
    items: services.map(toServiceResponse),
    total: services.length,
  };
}
