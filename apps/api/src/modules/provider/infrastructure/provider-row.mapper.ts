import type { Prisma } from '@prisma/client';

import type {
  ApprovalStatus,
  AvatarVisibility,
  CapabilityType,
  ComplianceStatus,
  DeliveryMode,
  ProviderCapability,
  ProviderProfile,
  ProviderType,
  VerificationLevel,
} from '../domain/provider-profile.model';

/**
 * Row -> domain mapping for the provider tables.
 *
 * Shared by the provider repositories (T005/T007) and by the discovery read
 * model (T010) so a column added later is mapped in exactly one place.
 */

export type ProviderProfileRow = {
  id: string;
  userId: string;
  providerType: ProviderType;
  publicName: string;
  headline: string | null;
  bio: string | null;
  avatarVisibility: AvatarVisibility;
  avatarAssetId: string | null;
  cityCode: string | null;
  serviceMode: DeliveryMode;
  approvalStatus: ApprovalStatus;
  searchable: boolean;
  ratingAvg: Prisma.Decimal | null;
  ratingCount: number;
  completedOrderCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export function mapProviderProfileRow(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    userId: row.userId,
    providerType: row.providerType,
    publicName: row.publicName,
    headline: row.headline,
    bio: row.bio,
    avatarVisibility: row.avatarVisibility,
    avatarAssetId: row.avatarAssetId,
    cityCode: row.cityCode,
    serviceMode: row.serviceMode,
    approvalStatus: row.approvalStatus,
    searchable: row.searchable,
    ratingAvg: row.ratingAvg === null ? null : row.ratingAvg.toNumber(),
    ratingCount: row.ratingCount,
    completedOrderCount: row.completedOrderCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ProviderCapabilityRow = {
  id: string;
  providerId: string;
  /** `provider_capabilities.capability_type` is a free string column. */
  capabilityType: string;
  status: ApprovalStatus;
  verificationLevel: VerificationLevel;
  complianceStatus: ComplianceStatus;
  restrictionJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export function mapProviderCapabilityRow(row: ProviderCapabilityRow): ProviderCapability {
  return {
    id: row.id,
    providerId: row.providerId,
    capabilityType: row.capabilityType as CapabilityType,
    status: row.status,
    verificationLevel: row.verificationLevel,
    complianceStatus: row.complianceStatus,
    restrictionJson: asJsonObject(row.restrictionJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `Json?` is read as `unknown`; narrow it to an object or `null`. */
export function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
