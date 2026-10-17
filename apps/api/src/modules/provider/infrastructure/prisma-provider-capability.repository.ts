import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CapabilityType,
  ComplianceStatus,
  CreateCapabilityInput,
  ProviderCapability,
  UpdateCapabilityInput,
} from '../domain/provider-profile.model';
import type { ProviderCapabilityRepository } from '../domain/provider-capability.repository';
import { mapProviderCapabilityRow } from './provider-row.mapper';

/** Prisma adapter for {@link ProviderCapabilityRepository}. */
@Injectable()
export class PrismaProviderCapabilityRepository implements ProviderCapabilityRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createMany(inputs: CreateCapabilityInput[]): Promise<ProviderCapability[]> {
    if (inputs.length === 0) {
      return [];
    }

    await this.prisma.providerCapability.createMany({
      data: inputs.map((input) => ({
        providerId: input.providerId,
        capabilityType: input.capabilityType,
        status: input.status ?? 'DRAFT',
        verificationLevel: input.verificationLevel ?? 'NONE',
        complianceStatus: input.complianceStatus ?? 'NOT_REQUIRED',
        restrictionJson: toJsonValue(input.restrictionJson ?? null),
      })),
    });

    return this.listByProvider(inputs[0]?.providerId ?? '');
  }

  async listByProvider(providerId: string): Promise<ProviderCapability[]> {
    const rows = await this.prisma.providerCapability.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapProviderCapabilityRow);
  }

  async findById(id: string): Promise<ProviderCapability | null> {
    const row = await this.prisma.providerCapability.findUnique({ where: { id } });
    return row ? mapProviderCapabilityRow(row) : null;
  }

  async findByProviderAndType(
    providerId: string,
    capabilityType: CapabilityType,
  ): Promise<ProviderCapability | null> {
    const row = await this.prisma.providerCapability.findFirst({
      where: { providerId, capabilityType },
    });
    return row ? mapProviderCapabilityRow(row) : null;
  }

  /**
   * Replace the capability set atomically.
   *
   * Only used while the application is editable, so no verification or order
   * references can exist yet.
   */
  async replaceForProvider(
    providerId: string,
    inputs: CreateCapabilityInput[],
  ): Promise<ProviderCapability[]> {
    return this.prisma.runInTransaction(async (tx) => {
      await tx.providerCapability.deleteMany({ where: { providerId } });

      if (inputs.length === 0) {
        return [];
      }

      await tx.providerCapability.createMany({
        data: inputs.map((input) => ({
          providerId: input.providerId,
          capabilityType: input.capabilityType,
          status: input.status ?? 'DRAFT',
          verificationLevel: input.verificationLevel ?? 'NONE',
          complianceStatus: input.complianceStatus ?? 'NOT_REQUIRED',
          restrictionJson: toJsonValue(input.restrictionJson ?? null),
        })),
      });

      const rows = await tx.providerCapability.findMany({
        where: { providerId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapProviderCapabilityRow);
    });
  }

  async listByComplianceStatus(filter: {
    statuses: ComplianceStatus[];
    capabilityType?: CapabilityType;
    limit: number;
  }): Promise<ProviderCapability[]> {
    const rows = await this.prisma.providerCapability.findMany({
      where: {
        complianceStatus: { in: filter.statuses },
        ...(filter.capabilityType === undefined ? {} : { capabilityType: filter.capabilityType }),
      },
      // Newest first: the reviewer sees the most recent cases first.
      orderBy: { updatedAt: 'desc' },
      take: filter.limit,
    });
    return rows.map(mapProviderCapabilityRow);
  }

  async update(id: string, input: UpdateCapabilityInput): Promise<ProviderCapability> {
    const row = await this.prisma.providerCapability.update({
      where: { id },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.verificationLevel === undefined
          ? {}
          : { verificationLevel: input.verificationLevel }),
        ...(input.complianceStatus === undefined
          ? {}
          : { complianceStatus: input.complianceStatus }),
        ...(input.restrictionJson === undefined
          ? {}
          : { restrictionJson: toJsonValue(input.restrictionJson) }),
      },
    });
    return mapProviderCapabilityRow(row);
  }
}

/** `Prisma.InputJsonValue` rejects `undefined`, so `null` clears the column. */
function toJsonValue(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonObject);
}
