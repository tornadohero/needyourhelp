/**
 * Verification contract (T006).
 *
 * Source of truth: `specs/05-api-spec.md` §Verification and §Admin,
 * `specs/04-database-spec.md` (§verification_cases / §verification_documents),
 * `specs/06-verification-state-machine.md` §Identity verification,
 * `specs/10-privacy-and-minors.md` §Verification documents and
 * `specs/03-architecture-spec.md` §External provider ports (`ObjectStorage`).
 *
 * Privacy: a verification document is private. Payloads below are allowlists
 * that never carry a storage key, a file hash, encrypted metadata or document
 * content (`AGENTS.md` §9, `specs/10-privacy-and-minors.md`).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * `verification_cases.verification_type`.
 *
 * `specs/01-business-rules.md` requires legal identity verification and
 * education verification; teacher compliance is reviewed as its own case type
 * (`specs/12-admin-spec.md` §Provider review workflow) while the compliance
 * *state* it feeds belongs to T007.
 */
export const VERIFICATION_TYPES = ['IDENTITY', 'EDUCATION', 'TEACHER_COMPLIANCE'] as const;
export type VerificationTypeName = (typeof VERIFICATION_TYPES)[number];

/**
 * `verification_cases.status` — `specs/06-verification-state-machine.md`
 * §Identity verification. `REJECTED` is not terminal: it can be resubmitted.
 */
export const VERIFICATION_CASE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'RESUBMITTED',
] as const;
export type VerificationCaseStatusName = (typeof VERIFICATION_CASE_STATUSES)[number];

/** `verification_documents.document_type`. */
export const VERIFICATION_DOCUMENT_TYPES = [
  'ID_CARD',
  'STUDENT_ID',
  'DIPLOMA',
  'TEACHER_CERTIFICATE',
  'EMPLOYMENT_PROOF',
  'OTHER',
] as const;
export type VerificationDocumentTypeName = (typeof VERIFICATION_DOCUMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * A document as seen by its owner and by reviewers.
 *
 * Only metadata: the object key, the file hash and the encrypted metadata stay
 * server-side (`specs/10-privacy-and-minors.md` §Verification documents).
 */
export interface VerificationDocumentResponse {
  id: string;
  documentType: VerificationDocumentTypeName;
  createdAt: string;
  expiresAt: string | null;
}

export interface VerificationCaseResponse {
  id: string;
  providerId: string;
  verificationType: VerificationTypeName;
  status: VerificationCaseStatusName;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Reason code recorded with the decision; `null` while undecided. */
  decisionReason: string | null;
  documents: VerificationDocumentResponse[];
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /verification/me`.
 *
 * A user reads only their own verification state
 * (`specs/07-permission-spec.md`).
 */
export interface MyVerificationResponse {
  providerId: string;
  cases: VerificationCaseResponse[];
}

/** Signed upload target returned by `POST /verification/cases/:id/documents/upload-url`. */
export interface VerificationUploadUrlResponse {
  documentId: string;
  documentType: VerificationDocumentTypeName;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** ISO-8601. The URL is short-lived (`specs/10-privacy-and-minors.md`). */
  expiresAt: string;
}

/**
 * Short-lived, audited access to a private document
 * (`specs/12-admin-spec.md`: "Identity-document access is logged").
 */
export interface VerificationDocumentAccessResponse {
  documentId: string;
  downloadUrl: string;
  expiresAt: string;
}

/**
 * One row of the admin review queue (`GET /admin/verifications`).
 *
 * Minimized by role (`specs/12-admin-spec.md` §Admin principles): the provider
 * is identified by name only.
 */
export interface AdminVerificationCaseResponse {
  id: string;
  providerId: string;
  providerName: string;
  verificationType: VerificationTypeName;
  status: VerificationCaseStatusName;
  documentCount: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVerificationQueueResponse {
  items: AdminVerificationCaseResponse[];
}
