import type {
  AdminComplianceItemResponse,
  ComplianceRestrictionResponse,
} from '@mentor/api-contracts';

import { parseRestriction } from '../domain/compliance-restriction';
import type { ComplianceQueueItem } from '../application/teacher-compliance.service';

/**
 * Response mapper for the admin compliance queue.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). The restriction is emitted without any reviewer note:
 * internal decision detail never leaves the server (`AGENTS.md` §9).
 */
export function toAdminComplianceItemResponse(
  item: ComplianceQueueItem,
): AdminComplianceItemResponse {
  const restriction = parseRestriction(item.capability.restrictionJson);

  return {
    capabilityId: item.capability.id,
    providerId: item.capability.providerId,
    providerName: item.providerName,
    capabilityType: item.capability.capabilityType,
    complianceStatus: item.capability.complianceStatus,
    restriction: toRestrictionResponse(restriction),
    updatedAt: item.capability.updatedAt.toISOString(),
  };
}

export function toAdminComplianceQueueResponse(items: ComplianceQueueItem[]): {
  items: AdminComplianceItemResponse[];
} {
  return { items: items.map(toAdminComplianceItemResponse) };
}

export function toRestrictionResponse(
  restriction: ReturnType<typeof parseRestriction>,
): ComplianceRestrictionResponse | null {
  if (!restriction) {
    return null;
  }
  return {
    allowedSubjectCodes: restriction.allowedSubjectCodes ?? null,
    allowedCityCodes: restriction.allowedCityCodes ?? null,
    allowedUntil: restriction.allowedUntil ?? null,
  };
}
