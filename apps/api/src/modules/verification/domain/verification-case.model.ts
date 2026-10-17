import type { VerificationLevel } from '../../provider/domain/provider-profile.model';

/**
 * Domain view of the verification aggregate
 * (`specs/04-database-spec.md` §verification_cases / §verification_documents,
 * `specs/02-domain-model.md` §Verification aggregate).
 *
 * Verification is a separate aggregate from the provider application: identity
 * verified never implies provider approved (`specs/01-business-rules.md`
 * §Provider approval).
 */

/** `verification_cases.verification_type`. */
export type VerificationType = 'IDENTITY' | 'EDUCATION' | 'TEACHER_COMPLIANCE';

/**
 * `verification_cases.status` — `specs/06-verification-state-machine.md`
 * §Identity verification.
 *
 * `REJECTED` is not terminal: the case can be resubmitted.
 */
export type VerificationStatus =
  'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESUBMITTED';

/** `verification_documents.document_type`. */
export type VerificationDocumentType =
  'ID_CARD' | 'STUDENT_ID' | 'DIPLOMA' | 'TEACHER_CERTIFICATE' | 'EMPLOYMENT_PROOF' | 'OTHER';

/**
 * Verification required before a provider can be discoverable.
 *
 * `specs/01-business-rules.md` §Student tutor: legal identity verification and
 * education verification. Career-specific requirements belong to T021.
 */
export const REQUIRED_VERIFICATION_TYPES: readonly VerificationType[] = ['IDENTITY', 'EDUCATION'];

export interface VerificationCase {
  id: string;
  providerId: string;
  verificationType: VerificationType;
  status: VerificationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewerId: string | null;
  /** Reason code recorded with the decision (`specs/06` §Admin decisions). */
  decisionReason: string | null;
  evidenceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A private evidence object.
 *
 * `storageKey`, `fileHash` and `encryptedMetadata` are internal: they are never
 * serialized into an API response. The document itself lives in a private
 * bucket and is reachable only through short-lived signed URLs
 * (`specs/10-privacy-and-minors.md` §Verification documents).
 */
export interface VerificationDocument {
  id: string;
  caseId: string;
  documentType: VerificationDocumentType;
  storageKey: string;
  /** SHA-256 of the uploaded file: `verification_documents.file_hash` is required. */
  fileHash: string;
  encryptedMetadata: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreateVerificationCaseInput {
  providerId: string;
  verificationType: VerificationType;
}

export interface UpdateVerificationCaseInput {
  status?: VerificationStatus;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewerId?: string | null;
  decisionReason?: string | null;
  evidenceRef?: string | null;
}

export interface CreateVerificationDocumentInput {
  caseId: string;
  documentType: VerificationDocumentType;
  storageKey: string;
  fileHash: string;
  encryptedMetadata?: string | null;
  expiresAt?: Date | null;
}

/**
 * Derive the capability verification level from the approved case types
 * (`provider_capabilities.verification_level`).
 *
 * Identity alone is `IDENTITY`, education alone is `EDUCATION`, both are `FULL`
 * and none is `NONE`. The level only ever describes verification: it never
 * grants permission to provide a service
 * (`specs/01-business-rules.md` §Teacher provider).
 */
export function verificationLevelFor(
  approvedTypes: readonly VerificationType[],
): VerificationLevel {
  const hasIdentity = approvedTypes.includes('IDENTITY');
  const hasEducation = approvedTypes.includes('EDUCATION');

  if (hasIdentity && hasEducation) {
    return 'FULL';
  }
  if (hasIdentity) {
    return 'IDENTITY';
  }
  if (hasEducation) {
    return 'EDUCATION';
  }
  return 'NONE';
}
