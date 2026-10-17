import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ParentProfile, UpsertParentProfileInput } from '../domain/parent-profile.model';
import type { ParentProfileRepository } from '../domain/parent-profile.repository';

/** Prisma adapter for {@link ParentProfileRepository}. */
@Injectable()
export class PrismaParentProfileRepository implements ParentProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<ParentProfile | null> {
    const row = await this.prisma.parentProfile.findUnique({ where: { userId } });
    return row ? mapParentProfile(row) : null;
  }

  async upsert(input: UpsertParentProfileInput): Promise<ParentProfile> {
    const row = await this.prisma.parentProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        displayName: input.displayName,
        cityCode: input.cityCode ?? null,
        timezone: input.timezone ?? 'Asia/Shanghai',
      },
      update: {
        displayName: input.displayName,
        ...(input.cityCode === undefined ? {} : { cityCode: input.cityCode }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      },
    });
    return mapParentProfile(row);
  }
}

type ParentProfileRow = {
  id: string;
  userId: string;
  displayName: string;
  cityCode: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapParentProfile(row: ParentProfileRow): ParentProfile {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    cityCode: row.cityCode,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
