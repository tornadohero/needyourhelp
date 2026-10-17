import type { ProviderCapabilityResponse, ProviderProfileResponse } from '@mentor/api-contracts';

import type { ProviderCapability } from '../domain/provider-profile.model';
import type { ProviderProfile } from '../domain/provider-profile.model';

/**
 * Response mappers.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). Timestamps are ISO-8601 (`AGENTS.md` §5).
 */
export function toProviderProfileResponse(
  profile: ProviderProfile,
  capabilities: ProviderCapability[],
): ProviderProfileResponse {
  return {
    id: profile.id,
    userId: profile.userId,
    providerType: profile.providerType,
    publicName: profile.publicName,
    headline: profile.headline,
    bio: profile.bio,
    avatarVisibility: profile.avatarVisibility,
    cityCode: profile.cityCode,
    serviceMode: profile.serviceMode,
    approvalStatus: profile.approvalStatus,
    searchable: profile.searchable,
    ratingAvg: profile.ratingAvg,
    ratingCount: profile.ratingCount,
    completedOrderCount: profile.completedOrderCount,
    capabilities: capabilities.map(toCapabilityResponse),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toCapabilityResponse(capability: ProviderCapability): ProviderCapabilityResponse {
  return {
    id: capability.id,
    capabilityType: capability.capabilityType,
    status: capability.status,
    verificationLevel: capability.verificationLevel,
    complianceStatus: capability.complianceStatus,
    createdAt: capability.createdAt.toISOString(),
  };
}
