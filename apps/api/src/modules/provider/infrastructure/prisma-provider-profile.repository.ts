import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ApprovalStatus,
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderType,
  UpdateProviderProfileInput,
} from '../domain/provider-profile.model';
import type { ProviderProfileRepository } from '../domain/provider-profile.repository';
import { mapProviderProfileRow } from './provider-row.mapper';

/** Prisma adapter for {@link ProviderProfileRepository}. */
@Injectable()
export class PrismaProviderProfileRepository implements ProviderProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateProviderProfileInput): Promise<ProviderProfile> {
    const row = await this.prisma.providerProfile.create({
      data: {
        userId: input.userId,
        providerType: input.providerType,
        publicName: input.publicName,
        headline: input.headline ?? null,
        bio: input.bio ?? null,
        avatarVisibility: input.avatarVisibility ?? 'PRIVATE',
        cityCode: input.cityCode ?? null,
        serviceMode: input.serviceMode ?? 'ONLINE',
        // A new application always starts as a draft and is never searchable.
        approvalStatus: 'DRAFT',
        searchable: false,
      },
    });
    return mapProviderProfileRow(row);
  }

  async findById(id: string): Promise<ProviderProfile | null> {
    const row = await this.prisma.providerProfile.findUnique({ where: { id } });
    return row ? mapProviderProfileRow(row) : null;
  }

  async findByUserAndType(
    userId: string,
    providerType: ProviderType,
  ): Promise<ProviderProfile | null> {
    const row = await this.prisma.providerProfile.findFirst({ where: { userId, providerType } });
    return row ? mapProviderProfileRow(row) : null;
  }

  async listByUser(userId: string): Promise<ProviderProfile[]> {
    const rows = await this.prisma.providerProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapProviderProfileRow);
  }

  async findManyByIds(ids: string[]): Promise<ProviderProfile[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prisma.providerProfile.findMany({ where: { id: { in: ids } } });
    return rows.map(mapProviderProfileRow);
  }

  async update(id: string, input: UpdateProviderProfileInput): Promise<ProviderProfile> {
    const row = await this.prisma.providerProfile.update({
      where: { id },
      data: {
        ...(input.publicName === undefined ? {} : { publicName: input.publicName }),
        ...(input.headline === undefined ? {} : { headline: input.headline }),
        ...(input.bio === undefined ? {} : { bio: input.bio }),
        ...(input.avatarVisibility === undefined
          ? {}
          : { avatarVisibility: input.avatarVisibility }),
        ...(input.cityCode === undefined ? {} : { cityCode: input.cityCode }),
        ...(input.serviceMode === undefined ? {} : { serviceMode: input.serviceMode }),
      },
    });
    return mapProviderProfileRow(row);
  }

  async setApprovalStatus(id: string, status: ApprovalStatus): Promise<ProviderProfile> {
    const row = await this.prisma.providerProfile.update({
      where: { id },
      data: { approvalStatus: status },
    });
    return mapProviderProfileRow(row);
  }

  async setSearchable(id: string, searchable: boolean): Promise<ProviderProfile> {
    const row = await this.prisma.providerProfile.update({
      where: { id },
      data: { searchable },
    });
    return mapProviderProfileRow(row);
  }

  async updateRating(id: string, ratingAvg: number, ratingCount: number): Promise<ProviderProfile> {
    const row = await this.prisma.providerProfile.update({
      where: { id },
      data: { ratingAvg, ratingCount },
    });
    return mapProviderProfileRow(row);
  }

  async incrementCompletedOrderCount(id: string): Promise<ProviderProfile> {
    // Incremented in the database: a concurrent completion cannot lose a count.
    const row = await this.prisma.providerProfile.update({
      where: { id },
      data: { completedOrderCount: { increment: 1 } },
    });
    return mapProviderProfileRow(row);
  }
}
