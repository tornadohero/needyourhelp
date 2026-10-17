import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ChildConsentStatus,
  ChildProfile,
  CreateChildProfileInput,
  UpdateChildProfileInput,
} from '../domain/child-profile.model';
import type { ChildProfileRepository } from '../domain/child-profile.repository';

/** Prisma adapter for {@link ChildProfileRepository}. */
@Injectable()
export class PrismaChildProfileRepository implements ChildProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateChildProfileInput): Promise<ChildProfile> {
    const row = await this.prisma.childProfile.create({
      data: {
        guardianUserId: input.guardianUserId,
        nickname: input.nickname,
        birthYear: input.birthYear ?? null,
        gradeCode: input.gradeCode ?? null,
        schoolName: input.schoolName ?? null,
        learningGoals: input.learningGoals ?? null,
        dataProcessingConsentStatus: input.dataProcessingConsentStatus,
      },
    });
    return mapChildProfile(row);
  }

  async findById(id: string): Promise<ChildProfile | null> {
    const row = await this.prisma.childProfile.findUnique({ where: { id } });
    return row ? mapChildProfile(row) : null;
  }

  async listByGuardian(guardianUserId: string): Promise<ChildProfile[]> {
    const rows = await this.prisma.childProfile.findMany({
      where: { guardianUserId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapChildProfile);
  }

  async update(id: string, input: UpdateChildProfileInput): Promise<ChildProfile> {
    const row = await this.prisma.childProfile.update({ where: { id }, data: input });
    return mapChildProfile(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.childProfile.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async setConsentStatusForGuardian(
    guardianUserId: string,
    status: ChildConsentStatus,
  ): Promise<number> {
    const result = await this.prisma.childProfile.updateMany({
      where: { guardianUserId, deletedAt: null },
      data: { dataProcessingConsentStatus: status },
    });
    return result.count;
  }
}

type ChildProfileRow = {
  id: string;
  guardianUserId: string;
  nickname: string;
  birthYear: number | null;
  gradeCode: string | null;
  schoolName: string | null;
  learningGoals: string | null;
  dataProcessingConsentStatus: ChildConsentStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapChildProfile(row: ChildProfileRow): ChildProfile {
  return {
    id: row.id,
    guardianUserId: row.guardianUserId,
    nickname: row.nickname,
    birthYear: row.birthYear,
    gradeCode: row.gradeCode,
    schoolName: row.schoolName,
    learningGoals: row.learningGoals,
    dataProcessingConsentStatus: row.dataProcessingConsentStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
