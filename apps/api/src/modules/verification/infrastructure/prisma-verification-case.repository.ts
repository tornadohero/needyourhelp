import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateVerificationCaseInput,
  CreateVerificationDocumentInput,
  UpdateVerificationCaseInput,
  VerificationCase,
  VerificationDocument,
  VerificationDocumentType,
  VerificationStatus,
  VerificationType,
} from '../domain/verification-case.model';
import type { VerificationCaseRepository } from '../domain/verification-case.repository';

/** Prisma adapter for {@link VerificationCaseRepository}. */
@Injectable()
export class PrismaVerificationCaseRepository implements VerificationCaseRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateVerificationCaseInput): Promise<VerificationCase> {
    const row = await this.prisma.verificationCase.create({
      data: {
        providerId: input.providerId,
        verificationType: input.verificationType,
        // A new case is always a draft: only an explicit command submits it.
        status: 'DRAFT',
      },
    });
    return mapCase(row);
  }

  async findById(id: string): Promise<VerificationCase | null> {
    const row = await this.prisma.verificationCase.findUnique({ where: { id } });
    return row ? mapCase(row) : null;
  }

  async findByProviderAndType(
    providerId: string,
    verificationType: VerificationType,
  ): Promise<VerificationCase | null> {
    const row = await this.prisma.verificationCase.findFirst({
      where: { providerId, verificationType },
    });
    return row ? mapCase(row) : null;
  }

  async listByProvider(providerId: string): Promise<VerificationCase[]> {
    const rows = await this.prisma.verificationCase.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapCase);
  }

  /** Newest first (`specs/12-admin-spec.md` §Provider review workflow). */
  async listQueue(filter: {
    status?: VerificationStatus[];
    limit: number;
  }): Promise<VerificationCase[]> {
    const rows = await this.prisma.verificationCase.findMany({
      where: filter.status && filter.status.length > 0 ? { status: { in: filter.status } } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit, 1), 100),
    });
    return rows.map(mapCase);
  }

  async update(id: string, input: UpdateVerificationCaseInput): Promise<VerificationCase> {
    const row = await this.prisma.verificationCase.update({
      where: { id },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.submittedAt === undefined ? {} : { submittedAt: input.submittedAt }),
        ...(input.reviewedAt === undefined ? {} : { reviewedAt: input.reviewedAt }),
        ...(input.reviewerId === undefined ? {} : { reviewerId: input.reviewerId }),
        ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason }),
        ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
      },
    });
    return mapCase(row);
  }

  async addDocument(input: CreateVerificationDocumentInput): Promise<VerificationDocument> {
    const row = await this.prisma.verificationDocument.create({
      data: {
        caseId: input.caseId,
        documentType: input.documentType,
        storageKey: input.storageKey,
        fileHash: input.fileHash ?? null,
        encryptedMetadata: input.encryptedMetadata ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return mapDocument(row);
  }

  async listDocuments(caseId: string): Promise<VerificationDocument[]> {
    const rows = await this.prisma.verificationDocument.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapDocument);
  }

  async findDocumentById(documentId: string): Promise<VerificationDocument | null> {
    const row = await this.prisma.verificationDocument.findUnique({ where: { id: documentId } });
    return row ? mapDocument(row) : null;
  }
}

type VerificationCaseRow = {
  id: string;
  providerId: string;
  verificationType: VerificationType;
  status: VerificationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewerId: string | null;
  decisionReason: string | null;
  evidenceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VerificationDocumentRow = {
  id: string;
  caseId: string;
  documentType: VerificationDocumentType;
  storageKey: string;
  fileHash: string;
  encryptedMetadata: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function mapCase(row: VerificationCaseRow): VerificationCase {
  return {
    id: row.id,
    providerId: row.providerId,
    verificationType: row.verificationType,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewerId: row.reviewerId,
    decisionReason: row.decisionReason,
    evidenceRef: row.evidenceRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDocument(row: VerificationDocumentRow): VerificationDocument {
  return {
    id: row.id,
    caseId: row.caseId,
    documentType: row.documentType,
    storageKey: row.storageKey,
    fileHash: row.fileHash,
    encryptedMetadata: row.encryptedMetadata,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
