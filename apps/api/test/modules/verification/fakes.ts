import type {
  ObjectStorageGateway,
  SignedDownload,
  SignedUpload,
  UploadTargetInput,
} from '../../../src/modules/verification/domain/object-storage.gateway';
import type { DocumentMetadataCipher } from '../../../src/modules/verification/domain/document-metadata-cipher';
import type {
  CreateVerificationCaseInput,
  CreateVerificationDocumentInput,
  UpdateVerificationCaseInput,
  VerificationCase,
  VerificationDocument,
  VerificationStatus,
  VerificationType,
} from '../../../src/modules/verification/domain/verification-case.model';
import type { VerificationCaseRepository } from '../../../src/modules/verification/domain/verification-case.repository';
import { nextId } from '../provider/fakes';

/** In-memory {@link VerificationCaseRepository}. */
export class FakeVerificationCaseRepository implements VerificationCaseRepository {
  readonly cases = new Map<string, VerificationCase>();
  readonly documents = new Map<string, VerificationDocument>();
  /** Insertion order, used to break `createdAt` ties deterministically. */
  private order = 0;
  private readonly sequence = new Map<string, number>();

  async create(input: CreateVerificationCaseInput): Promise<VerificationCase> {
    const now = new Date();
    const created: VerificationCase = {
      id: nextId('case'),
      providerId: input.providerId,
      verificationType: input.verificationType,
      status: 'DRAFT',
      submittedAt: null,
      reviewedAt: null,
      reviewerId: null,
      decisionReason: null,
      evidenceRef: null,
      createdAt: now,
      updatedAt: now,
    };
    this.cases.set(created.id, created);
    this.order += 1;
    this.sequence.set(created.id, this.order);
    return created;
  }

  async findById(id: string): Promise<VerificationCase | null> {
    return this.cases.get(id) ?? null;
  }

  async findByProviderAndType(
    providerId: string,
    verificationType: VerificationType,
  ): Promise<VerificationCase | null> {
    return (
      [...this.cases.values()].find(
        (item) => item.providerId === providerId && item.verificationType === verificationType,
      ) ?? null
    );
  }

  async listByProvider(providerId: string): Promise<VerificationCase[]> {
    return [...this.cases.values()].filter((item) => item.providerId === providerId);
  }

  /** Newest first, like the Prisma adapter. */
  async listQueue(filter: {
    status?: VerificationStatus[];
    limit: number;
  }): Promise<VerificationCase[]> {
    return [...this.cases.values()]
      .filter((item) => !filter.status || filter.status.includes(item.status))
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          (this.sequence.get(right.id) ?? 0) - (this.sequence.get(left.id) ?? 0),
      )
      .slice(0, filter.limit);
  }

  async update(id: string, input: UpdateVerificationCaseInput): Promise<VerificationCase> {
    const current = this.cases.get(id);
    if (!current) {
      throw new Error('case not found');
    }
    const updated: VerificationCase = { ...current, ...input, updatedAt: new Date() };
    this.cases.set(id, updated);
    return updated;
  }

  async addDocument(input: CreateVerificationDocumentInput): Promise<VerificationDocument> {
    const created: VerificationDocument = {
      id: nextId('document'),
      caseId: input.caseId,
      documentType: input.documentType,
      storageKey: input.storageKey,
      fileHash: input.fileHash,
      encryptedMetadata: input.encryptedMetadata ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(),
    };
    this.documents.set(created.id, created);
    return created;
  }

  async listDocuments(caseId: string): Promise<VerificationDocument[]> {
    return [...this.documents.values()].filter((document) => document.caseId === caseId);
  }

  async findDocumentById(documentId: string): Promise<VerificationDocument | null> {
    return this.documents.get(documentId) ?? null;
  }

  /** Test helper: force a status without going through a command. */
  async forceStatus(id: string, status: VerificationStatus): Promise<VerificationCase> {
    return this.update(id, { status });
  }
}

/** Deterministic {@link ObjectStorageGateway} that records every signed URL. */
export class FakeObjectStorageGateway implements ObjectStorageGateway {
  readonly uploads: UploadTargetInput[] = [];
  readonly downloads: string[] = [];

  constructor(
    private readonly options: { uploadTtlSeconds?: number; downloadTtlSeconds?: number } = {},
  ) {}

  async createUploadUrl(input: UploadTargetInput): Promise<SignedUpload> {
    this.uploads.push(input);
    return {
      url: `https://storage.test/${input.key}?purpose=upload`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresAt: new Date(Date.now() + (this.options.uploadTtlSeconds ?? 900) * 1000),
    };
  }

  async createDownloadUrl(input: { key: string }): Promise<SignedDownload> {
    this.downloads.push(input.key);
    return {
      url: `https://storage.test/${input.key}?purpose=download`,
      expiresAt: new Date(Date.now() + (this.options.downloadTtlSeconds ?? 300) * 1000),
    };
  }
}

/**
 * {@link DocumentMetadataCipher} that keeps the payload readable in tests while
 * proving the caller never handles raw metadata.
 */
export class FakeDocumentMetadataCipher implements DocumentMetadataCipher {
  seal(metadata: Record<string, unknown>): string {
    return `sealed:${JSON.stringify(metadata)}`;
  }

  open(sealed: string): Record<string, unknown> | null {
    if (!sealed.startsWith('sealed:')) {
      return null;
    }
    return JSON.parse(sealed.slice('sealed:'.length)) as Record<string, unknown>;
  }
}

/** A SHA-256-shaped digest for fixtures. */
export const FILE_HASH = 'a'.repeat(64);
