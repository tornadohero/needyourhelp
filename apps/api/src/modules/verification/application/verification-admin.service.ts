import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../provider/domain/provider-capability.repository';
import type { ProviderCapabilityRepository } from '../../provider/domain/provider-capability.repository';
import type { ProviderProfile } from '../../provider/domain/provider-profile.model';
import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import { ProviderApplicationService } from '../../provider/application/provider-application.service';
import type { VerificationStatus, VerificationType } from '../domain/verification-case.model';
import { verificationLevelFor } from '../domain/verification-case.model';
import { VERIFICATION_CASE_REPOSITORY } from '../domain/verification-case.repository';
import type { VerificationCaseRepository } from '../domain/verification-case.repository';
import { OBJECT_STORAGE_GATEWAY } from '../domain/object-storage.gateway';
import type { ObjectStorageGateway, SignedDownload } from '../domain/object-storage.gateway';
import { verificationInvalidState, verificationNotFound } from '../domain/verification.errors';
import { isDecidable } from '../domain/verification-policy';

export interface VerificationDecisionContext {
  /** The authenticated admin/ops account: the actor recorded in the audit row. */
  actorUserId: string;
  /** Required for every decision (`specs/06` §Admin decision requirements). */
  reasonCode: string;
  notes?: string | null;
  requestId: string;
  ipHash?: string | null;
}

export interface VerificationQueueItem {
  id: string;
  providerId: string;
  providerName: string;
  verificationType: VerificationType;
  status: VerificationStatus;
  documentCount: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admin verification decisions (`specs/12-admin-spec.md`: every mutation is
 * audited, identity-document access is logged).
 *
 * Rules enforced here:
 * - a provider cannot decide their own case: this service is only reachable
 *   through an admin route guarded by `RolesGuard`
 *   (`specs/07-permission-spec.md`);
 * - only the transitions defined by the state machine are allowed;
 * - every decision writes an audit row with actor, reason code, before/after
 *   snapshot and request id (`specs/06` §Admin decision requirements);
 * - a private document is only reachable through a short-lived signed URL, and
 *   every issuance is audited.
 */
@Injectable()
export class VerificationAdminService {
  constructor(
    @Inject(VERIFICATION_CASE_REPOSITORY) private readonly cases: VerificationCaseRepository,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(PROVIDER_CAPABILITY_REPOSITORY)
    private readonly capabilities: ProviderCapabilityRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(OBJECT_STORAGE_GATEWAY) private readonly storage: ObjectStorageGateway,
    @Inject(ProviderApplicationService) private readonly applications: ProviderApplicationService,
  ) {}

  /** `GET /admin/verifications`: newest first (`specs/12-admin-spec.md`). */
  async listQueue(filter: { status?: string[]; limit: number }): Promise<VerificationQueueItem[]> {
    const cases = await this.cases.listQueue({
      status: filter.status as never,
      limit: filter.limit,
    });

    const items: VerificationQueueItem[] = [];
    for (const verificationCase of cases) {
      const profile = await this.profiles.findById(verificationCase.providerId);
      items.push({
        id: verificationCase.id,
        providerId: verificationCase.providerId,
        providerName: profile?.publicName ?? '',
        verificationType: verificationCase.verificationType,
        status: verificationCase.status,
        documentCount: (await this.cases.listDocuments(verificationCase.id)).length,
        submittedAt: verificationCase.submittedAt,
        reviewedAt: verificationCase.reviewedAt,
        decisionReason: verificationCase.decisionReason,
        createdAt: verificationCase.createdAt,
        updatedAt: verificationCase.updatedAt,
      });
    }
    return items;
  }

  /** `POST /admin/verifications/:id/approve`. */
  async approve(caseId: string, context: VerificationDecisionContext) {
    const reasonCode = requireReasonCode(context.reasonCode);
    const verificationCase = await this.requireCase(caseId);
    assertDecidable(verificationCase.status);

    const reviewedAt = new Date();
    const approved = await this.cases.update(caseId, {
      status: 'APPROVED',
      reviewedAt,
      reviewerId: context.actorUserId,
      decisionReason: reasonCode,
      evidenceRef: `request:${context.requestId}`,
    });

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.verificationApproved,
      resourceType: 'verification_case',
      resourceId: caseId,
      beforeJson: snapshot(verificationCase),
      afterJson: { ...snapshot(approved), notes: context.notes ?? null },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    await this.applyVerificationOutcome(approved.providerId);
    return this.toQueueItem(approved);
  }

  /** `POST /admin/verifications/:id/reject`. */
  async reject(caseId: string, context: VerificationDecisionContext) {
    const reasonCode = requireReasonCode(context.reasonCode);
    const verificationCase = await this.requireCase(caseId);
    assertDecidable(verificationCase.status);

    const reviewedAt = new Date();
    const rejected = await this.cases.update(caseId, {
      status: 'REJECTED',
      reviewedAt,
      reviewerId: context.actorUserId,
      decisionReason: reasonCode,
      evidenceRef: `request:${context.requestId}`,
    });

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.verificationRejected,
      resourceType: 'verification_case',
      resourceId: caseId,
      beforeJson: snapshot(verificationCase),
      afterJson: { ...snapshot(rejected), notes: context.notes ?? null },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    await this.applyVerificationOutcome(rejected.providerId);
    return this.toQueueItem(rejected);
  }

  /**
   * Short-lived access to a private document.
   *
   * The route is admin-only and every issuance is audited
   * (`specs/12-admin-spec.md`: "Identity-document access is logged";
   * `specs/07-permission-spec.md`: access is permissioned and audited).
   */
  async createDocumentAccessUrl(
    caseId: string,
    documentId: string,
    context: VerificationDecisionContext,
  ): Promise<{ documentId: string; download: SignedDownload }> {
    const verificationCase = await this.requireCase(caseId);
    const document = await this.cases.findDocumentById(documentId);

    if (!document || document.caseId !== verificationCase.id) {
      throw verificationNotFound('Verification document not found.');
    }

    const download = await this.storage.createDownloadUrl({ key: document.storageKey });

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.verificationDocumentAccessed,
      resourceType: 'verification_document',
      resourceId: document.id,
      beforeJson: { caseId: verificationCase.id, documentType: document.documentType },
      afterJson: {
        caseId: verificationCase.id,
        documentType: document.documentType,
        expiresAt: download.expiresAt.toISOString(),
        reasonCode: context.reasonCode,
      },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return { documentId: document.id, download };
  }

  /** Queue projection of a single case (`GET /admin/verifications`). */
  private async toQueueItem(verificationCase: {
    id: string;
    providerId: string;
    verificationType: VerificationType;
    status: VerificationStatus;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    decisionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<VerificationQueueItem> {
    const profile = await this.profiles.findById(verificationCase.providerId);
    return {
      id: verificationCase.id,
      providerId: verificationCase.providerId,
      providerName: profile?.publicName ?? '',
      verificationType: verificationCase.verificationType,
      status: verificationCase.status,
      documentCount: (await this.cases.listDocuments(verificationCase.id)).length,
      submittedAt: verificationCase.submittedAt,
      reviewedAt: verificationCase.reviewedAt,
      decisionReason: verificationCase.decisionReason,
      createdAt: verificationCase.createdAt,
      updatedAt: verificationCase.updatedAt,
    };
  }

  private async requireCase(caseId: string) {
    const verificationCase = await this.cases.findById(caseId);
    if (!verificationCase) {
      throw verificationNotFound();
    }
    return verificationCase;
  }

  /**
   * Mirror the verification outcome onto the provider's capabilities and
   * recompute discoverability.
   *
   * `verification_level` is verification data stored on the capability, so the
   * verification context owns it; `searchable` belongs to the provider context
   * and is recomputed by T005's service (approval remains a separate gate).
   */
  private async applyVerificationOutcome(providerId: string): Promise<void> {
    const cases = await this.cases.listByProvider(providerId);
    const approvedTypes = cases
      .filter((verificationCase) => verificationCase.status === 'APPROVED')
      .map((verificationCase) => verificationCase.verificationType);

    const level = verificationLevelFor(approvedTypes);
    const capabilities = await this.capabilities.listByProvider(providerId);
    for (const capability of capabilities) {
      if (capability.verificationLevel !== level) {
        await this.capabilities.update(capability.id, { verificationLevel: level });
      }
    }

    const profile: ProviderProfile | null = await this.profiles.findById(providerId);
    if (profile) {
      await this.applications.refreshSearchable(profile);
    }
  }
}

/** Every admin decision carries a reason code (`specs/06`). */
function requireReasonCode(reasonCode: string | undefined): string {
  const trimmed = reasonCode?.trim();
  if (!trimmed) {
    throw verificationInvalidState('A reason code is required for a verification decision.');
  }
  return trimmed;
}

function assertDecidable(status: string): void {
  if (!isDecidable(status as never)) {
    throw verificationInvalidState(`A verification case in status ${status} cannot be decided.`);
  }
}

/** Before/after snapshot of the fields an admin decision may change. */
function snapshot(verificationCase: {
  status: string;
  verificationType: VerificationType;
  providerId: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
}): Record<string, unknown> {
  return {
    status: verificationCase.status,
    verificationType: verificationCase.verificationType,
    providerId: verificationCase.providerId,
    submittedAt: verificationCase.submittedAt?.toISOString() ?? null,
    reviewedAt: verificationCase.reviewedAt?.toISOString() ?? null,
    decisionReason: verificationCase.decisionReason,
  };
}
