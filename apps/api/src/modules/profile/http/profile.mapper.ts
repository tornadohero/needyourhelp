import type {
  ChildProfileResponse,
  ConsentResponse,
  ParentProfileResponse,
  ProfileResponse,
} from '@mentor/api-contracts';

import type { Consent } from '../../identity/domain/consent.model';
import type { OwnProfile } from '../application/profile.service';
import type { ChildProfile } from '../domain/child-profile.model';
import type { ParentProfile } from '../domain/parent-profile.model';

/**
 * Response mappers.
 *
 * Every payload is built field by field (allowlist) instead of serializing ORM
 * entities (`AGENTS.md` §10, `specs/10-privacy-and-minors.md` §Data access).
 * Timestamps are ISO-8601 (`AGENTS.md` §5).
 */
export function toProfileResponse(profile: OwnProfile): ProfileResponse {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    parentProfile: profile.parentProfile ? toParentProfileResponse(profile.parentProfile) : null,
  };
}

export function toParentProfileResponse(profile: ParentProfile): ParentProfileResponse {
  return {
    id: profile.id,
    displayName: profile.displayName,
    cityCode: profile.cityCode,
    timezone: profile.timezone,
  };
}

/**
 * Guardian-scoped child payload.
 *
 * This is the only mapper allowed to emit child detail; callers must have
 * already proven guardianship (`specs/07-permission-spec.md` §Field-level
 * privacy). No public or provider-facing projection may reuse it.
 */
export function toChildResponse(child: ChildProfile): ChildProfileResponse {
  return {
    id: child.id,
    nickname: child.nickname,
    birthYear: child.birthYear,
    gradeCode: child.gradeCode,
    schoolName: child.schoolName,
    learningGoals: child.learningGoals,
    consentStatus: child.dataProcessingConsentStatus,
    createdAt: child.createdAt.toISOString(),
  };
}

export function toConsentResponse(consent: Consent): ConsentResponse {
  return {
    id: consent.id,
    consentType: consent.consentType,
    policyVersion: consent.policyVersion,
    granted: consent.granted,
    grantedAt: consent.grantedAt.toISOString(),
    revokedAt: consent.revokedAt ? consent.revokedAt.toISOString() : null,
  };
}
