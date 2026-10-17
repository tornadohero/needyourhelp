import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateServiceInput,
  Service,
  ServiceStatus,
  UpdateServiceInput,
} from '../domain/service.model';
import type { ServiceRepository } from '../domain/service.repository';
import { SERVICE_TERMS_INCLUDE, mapServiceRow } from './service-row.mapper';

/** Prisma adapter for {@link ServiceRepository}. */
@Injectable()
export class PrismaServiceRepository implements ServiceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateServiceInput): Promise<Service> {
    const row = await this.prisma.service.create({
      data: {
        providerId: input.providerId,
        domain: input.domain,
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        priceMinor: input.priceMinor,
        currency: input.currency,
        deliveryMode: input.deliveryMode,
        // A new service is never sellable: publishing is an explicit command.
        status: 'DRAFT',
        terms: { create: input.termIds.map((termId) => ({ termId })) },
      },
      include: SERVICE_TERMS_INCLUDE,
    });

    return mapServiceRow(row);
  }

  async findById(id: string): Promise<Service | null> {
    const row = await this.prisma.service.findUnique({
      where: { id },
      include: SERVICE_TERMS_INCLUDE,
    });
    return row ? mapServiceRow(row) : null;
  }

  async listByProvider(providerId: string): Promise<Service[]> {
    const rows = await this.prisma.service.findMany({
      where: { providerId },
      include: SERVICE_TERMS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapServiceRow);
  }

  async update(id: string, input: UpdateServiceInput): Promise<Service> {
    const termIds = input.termIds;

    // Tags are replaced as a whole: one transaction, so a service can never be
    // observed half-tagged.
    await this.prisma.$transaction(async (tx) => {
      if (termIds !== undefined) {
        await tx.serviceTerm.deleteMany({ where: { serviceId: id } });
        if (termIds.length > 0) {
          await tx.serviceTerm.createMany({
            data: termIds.map((termId) => ({ serviceId: id, termId })),
          });
        }
      }

      await tx.service.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.durationMinutes === undefined
            ? {}
            : { durationMinutes: input.durationMinutes }),
          ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
          ...(input.currency === undefined ? {} : { currency: input.currency }),
          ...(input.deliveryMode === undefined ? {} : { deliveryMode: input.deliveryMode }),
        },
      });
    });

    const row = await this.prisma.service.findUniqueOrThrow({
      where: { id },
      include: SERVICE_TERMS_INCLUDE,
    });
    return mapServiceRow(row);
  }

  async setStatus(id: string, status: ServiceStatus): Promise<Service> {
    const row = await this.prisma.service.update({
      where: { id },
      data: { status },
      include: SERVICE_TERMS_INCLUDE,
    });
    return mapServiceRow(row);
  }

  async hasPublished(providerId: string): Promise<boolean> {
    const count = await this.prisma.service.count({
      where: { providerId, status: 'PUBLISHED' },
    });
    return count > 0;
  }
}
