import type {
  CreateVerificationCaseInput,
  CreateVerificationDocumentInput,
  UpdateVerificationCaseInput,
  VerificationCase,
  VerificationDocument,
  VerificationStatus,
  VerificationType,
} from './verification-case.model';

/** Dependency-injection token for {@link VerificationCaseRepository}. */
export const VERIFICATION_CASE_REPOSITORY = 'VERIFICATION_CASE_REPOSITORY';

export interface VerificationCaseRepository {
  create(input: CreateVerificationCaseInput): Promise<VerificationCase>;

  findById(id: string): Promise<VerificationCase | null>;

  /**
   * One case per (provider, type).
   *
   * A rejection is resubmitted through the same case, so the review history is
   * preserved (`specs/06-verification-state-machine.md` §Identity verification).
   */
  findByProviderAndType(
    providerId: string,
    verificationType: VerificationType,
  ): Promise<VerificationCase | null>;

  listByProvider(providerId: string): Promise<VerificationCase[]>;

  /**
   * Admin review queue: newest first (`specs/12-admin-spec.md`
   * §Provider review workflow).
   */
  listQueue(filter: { status?: VerificationStatus[]; limit: number }): Promise<VerificationCase[]>;

  /** Explicit state change; only ever called through a command. */
  update(id: string, input: UpdateVerificationCaseInput): Promise<VerificationCase>;

  addDocument(input: CreateVerificationDocumentInput): Promise<VerificationDocument>;

  listDocuments(caseId: string): Promise<VerificationDocument[]>;

  findDocumentById(documentId: string): Promise<VerificationDocument | null>;
}
