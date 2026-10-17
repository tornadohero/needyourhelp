import type {
  AdminVerificationCaseResponse,
  AdminVerificationQueueResponse,
  MyVerificationResponse,
  VerificationCaseResponse,
  VerificationDocumentResponse,
} from '@mentor/api-contracts';

import type { VerificationCase, VerificationDocument } from '../domain/verification-case.model';
import type { VerificationQueueItem } from '../application/verification-admin.service';

/**
 * Response mappers.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10): a document's `storageKey`, `fileHash` and
 * `encryptedMetadata` are deliberately absent from every payload.
 * Timestamps are ISO-8601 (`AGENTS.md` §5).
 */
export function toVerificationCaseResponse(
  verificationCase: VerificationCase,
  documents: VerificationDocument[],
): VerificationCaseResponse {
  return {
    id: verificationCase.id,
    providerId: verificationCase.providerId,
    verificationType: verificationCase.verificationType,
    status: verificationCase.status,
    submittedAt: verificationCase.submittedAt?.toISOString() ?? null,
    reviewedAt: verificationCase.reviewedAt?.toISOString() ?? null,
    decisionReason: verificationCase.decisionReason,
    documents: documents.map(toDocumentResponse),
    createdAt: verificationCase.createdAt.toISOString(),
    updatedAt: verificationCase.updatedAt.toISOString(),
  };
}

export function toDocumentResponse(document: VerificationDocument): VerificationDocumentResponse {
  return {
    id: document.id,
    documentType: document.documentType,
    createdAt: document.createdAt.toISOString(),
    expiresAt: document.expiresAt?.toISOString() ?? null,
  };
}

export function toMyVerificationResponse(
  providerId: string,
  views: { case: VerificationCase; documents: VerificationDocument[] }[],
): MyVerificationResponse {
  return {
    providerId,
    cases: views.map((view) => toVerificationCaseResponse(view.case, view.documents)),
  };
}

export function toAdminVerificationCaseResponse(
  item: VerificationQueueItem,
): AdminVerificationCaseResponse {
  return {
    id: item.id,
    providerId: item.providerId,
    providerName: item.providerName,
    verificationType: item.verificationType,
    status: item.status as AdminVerificationCaseResponse['status'],
    documentCount: item.documentCount,
    submittedAt: item.submittedAt?.toISOString() ?? null,
    reviewedAt: item.reviewedAt?.toISOString() ?? null,
    decisionReason: item.decisionReason,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toAdminVerificationQueueResponse(
  items: VerificationQueueItem[],
): AdminVerificationQueueResponse {
  return { items: items.map(toAdminVerificationCaseResponse) };
}
