import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfile, ProviderType } from '../../provider/domain/provider-profile.model';
import { DOCUMENT_METADATA_CIPHER } from '../domain/document-metadata-cipher';
import type { DocumentMetadataCipher } from '../domain/document-metadata-cipher';
import { OBJECT_STORAGE_GATEWAY } from '../domain/object-storage.gateway';
import type { ObjectStorageGateway, SignedUpload } from '../domain/object-storage.gateway';
import type {
  VerificationCase,
  VerificationDocument,
  VerificationDocumentType,
  VerificationType,
} from '../domain/verification-case.model';
import { VERIFICATION_CASE_REPOSITORY } from '../domain/verification-case.repository';
import type { VerificationCaseRepository } from '../domain/verification-case.repository';
import {
  VERIFICATION_DOCUMENT_MAX_BYTES,
  buildDocumentKey,
  isAllowedDocumentContentType,
  isSha256Hex,
} from '../domain/verification-document-policy';
import {
  verificationForbidden,
  verificationInvalidState,
  verificationNotFound,
} from '../domain/verification.errors';
import { isEditable, submissionTarget } from '../domain/verification-policy';

export interface CreateCaseInput {
  verificationType: VerificationType;
  /** Defaults to `TUTORING`: the career marketplace is flagged (T021). */
  providerType?: ProviderType;
}

export interface RequestUploadUrlInput {
  documentType: VerificationDocumentType;
  contentType: string;
  byteSize: number;
  /** Optional original file name; stored encrypted, never exposed. */
  filename?: string | null;
  /** SHA-256 digest of the file: `verification_documents.file_hash` is required. */
  fileHash: string;
}

export interface DocumentUploadTarget {
  document: VerificationDocument;
  upload: SignedUpload;
}

export interface VerificationCaseView {
  case: VerificationCase;
  documents: VerificationDocument[];
}

/**
 * Provider-side verification: case intake, evidence upload and submission
 * (`specs/05-api-spec.md` §Verification).
 *
 * The provider never decides the outcome of a case: submission and the admin
 * decision are separate commands (`specs/06-verification-state-machine.md`).
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(VERIFICATION_CASE_REPOSITORY) private readonly cases: VerificationCaseRepository,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(OBJECT_STORAGE_GATEWAY) private readonly storage: ObjectStorageGateway,
    @Inject(DOCUMENT_METADATA_CIPHER) private readonly cipher: DocumentMetadataCipher,
    /** Maximum accepted document size; configurable for tests and deployments. */
    @Inject(VERIFICATION_DOCUMENT_MAX_BYTES) private readonly maxDocumentBytes: number,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `POST /verification/cases`. */
  async createCase(userId: string, input: CreateCaseInput): Promise<VerificationCase> {
    const profile = await this.requireOwnProfile(userId, input.providerType ?? 'TUTORING');

    const existing = await this.cases.findByProviderAndType(profile.id, input.verificationType);
    if (existing) {
      throw verificationInvalidState(
        `A ${input.verificationType} verification case already exists for this provider.`,
      );
    }

    return this.cases.create({
      providerId: profile.id,
      verificationType: input.verificationType,
    });
  }

  /** `GET /verification/me`. */
  async listMyCases(
    userId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<{ providerId: string; views: VerificationCaseView[] }> {
    const profile = await this.requireOwnProfile(userId, providerType);
    const cases = await this.cases.listByProvider(profile.id);

    const views: VerificationCaseView[] = [];
    for (const verificationCase of cases) {
      views.push({
        case: verificationCase,
        documents: await this.cases.listDocuments(verificationCase.id),
      });
    }

    return { providerId: profile.id, views };
  }

  /**
   * `POST /verification/cases/:id/documents/upload-url`.
   *
   * The object key is generated here and the document row is persisted before
   * the client uploads: the storage gateway only ever receives a key the server
   * chose (`specs/13-security-spec.md` §File upload).
   */
  async requestUploadUrl(
    userId: string,
    caseId: string,
    input: RequestUploadUrlInput,
  ): Promise<DocumentUploadTarget> {
    const { case: verificationCase } = await this.requireOwnCase(userId, caseId);

    if (!isEditable(verificationCase.status)) {
      throw verificationInvalidState(
        `Evidence cannot be attached to a case in status ${verificationCase.status}.`,
      );
    }

    const contentType = input.contentType?.trim().toLowerCase() ?? '';
    if (!isAllowedDocumentContentType(contentType)) {
      throw verificationInvalidState(`Content type ${input.contentType} is not accepted.`);
    }
    if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
      throw verificationInvalidState('A positive document size is required.');
    }
    if (input.byteSize > this.maxDocumentBytes) {
      throw verificationInvalidState('The document exceeds the maximum accepted size.');
    }
    if (!isSha256Hex(input.fileHash)) {
      throw verificationInvalidState('The file hash must be a SHA-256 hex digest.');
    }

    const storageKey = buildDocumentKey(verificationCase.id);
    const upload = await this.storage.createUploadUrl({
      key: storageKey,
      contentType,
      contentLength: input.byteSize,
    });

    const document = await this.cases.addDocument({
      caseId: verificationCase.id,
      documentType: input.documentType,
      storageKey,
      fileHash: input.fileHash,
      encryptedMetadata: this.cipher.seal({
        filename: input.filename ?? null,
        contentType,
        byteSize: input.byteSize,
      }),
      expiresAt: upload.expiresAt,
    });

    return { document, upload };
  }

  /** `POST /verification/cases/:id/submit`. */
  async submitCase(
    userId: string,
    caseId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<VerificationCaseView> {
    const { case: verificationCase, documents } = await this.requireOwnCase(
      userId,
      caseId,
      providerType,
    );

    const target = submissionTarget(verificationCase.status);
    if (!target) {
      throw verificationInvalidState(
        `A verification case in status ${verificationCase.status} cannot be submitted.`,
      );
    }
    if (documents.length === 0) {
      throw verificationInvalidState('At least one document is required before submitting.');
    }

    const submitted = await this.cases.update(verificationCase.id, {
      status: target,
      submittedAt: new Date(),
    });

    await this.analytics?.track({
      name: 'verification_submitted',
      actorUserId: userId,
      providerId: submitted.providerId,
      props: { verification_type: submitted.verificationType.toLowerCase() },
    });

    return { case: submitted, documents };
  }

  /** Resolves the caller's provider profile, or fails: verification needs one. */
  private async requireOwnProfile(
    userId: string,
    providerType: ProviderType,
  ): Promise<ProviderProfile> {
    const profile = await this.profiles.findByUserAndType(userId, providerType);
    if (!profile) {
      throw verificationInvalidState('Create a provider application before starting verification.');
    }
    return profile;
  }

  /** Loads a case and asserts the caller owns the provider it belongs to. */
  private async requireOwnCase(
    userId: string,
    caseId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<VerificationCaseView> {
    const verificationCase = await this.cases.findById(caseId);
    if (!verificationCase) {
      throw verificationNotFound();
    }

    const profile = await this.profiles.findByUserAndType(userId, providerType);
    // A case of another provider is reported as not found: ownership must not be
    // observable through the error (`specs/13-security-spec.md`).
    if (!profile || profile.id !== verificationCase.providerId) {
      throw verificationForbidden();
    }

    return { case: verificationCase, documents: await this.cases.listDocuments(caseId) };
  }
}
