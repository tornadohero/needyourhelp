import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { slotOverlapError } from '../domain/availability.errors';
import { CONFLICTING_STATUSES, findOverlap } from '../domain/availability-policy';
import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CreateSlotInput,
} from '../domain/availability-slot.model';
import type { AvailabilitySlotRepository } from '../domain/availability-slot.repository';

/** Prisma adapter for {@link AvailabilitySlotRepository}. */
@Injectable()
export class PrismaAvailabilitySlotRepository implements AvailabilitySlotRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateSlotInput): Promise<AvailabilitySlot> {
    // Check and insert in one transaction: a slot is never created against a
    // window somebody else just took. The database exclusion constraint
    // (`availability_slots_no_overlap`) is the last line of defence.
    return this.prisma.runInTransaction(async (tx) => {
      const existing = await tx.availabilitySlot.findMany({
        where: {
          providerId: input.providerId,
          status: { in: [...CONFLICTING_STATUSES] },
          startAt: { lt: input.endAt },
          endAt: { gt: input.startAt },
        },
      });

      const clash = findOverlap(existing.map(mapSlot), {
        startAt: input.startAt,
        endAt: input.endAt,
      });
      if (clash) {
        throw slotOverlapError();
      }

      const row = await tx.availabilitySlot.create({
        data: {
          providerId: input.providerId,
          startAt: input.startAt,
          endAt: input.endAt,
          recurrenceRule: input.recurrenceRule,
          // A new slot is always bookable; a booking is an explicit claim.
          status: 'OPEN',
        },
      });
      return mapSlot(row);
    });
  }

  async findById(id: string): Promise<AvailabilitySlot | null> {
    const row = await this.prisma.availabilitySlot.findUnique({ where: { id } });
    return row ? mapSlot(row) : null;
  }

  async listByProvider(
    providerId: string,
    options: { statuses?: readonly AvailabilityStatus[]; from?: Date; limit?: number } = {},
  ): Promise<AvailabilitySlot[]> {
    const rows = await this.prisma.availabilitySlot.findMany({
      where: {
        providerId,
        ...(options.statuses ? { status: { in: [...options.statuses] } } : {}),
        ...(options.from ? { startAt: { gte: options.from } } : {}),
      },
      orderBy: { startAt: 'asc' },
      ...(options.limit === undefined ? {} : { take: options.limit }),
    });
    return rows.map(mapSlot);
  }

  async deleteIfOpen(id: string): Promise<string | null> {
    // Conditional delete: a booked slot can never be removed underneath a
    // confirmed booking.
    const deleted = await this.prisma.availabilitySlot.deleteMany({
      where: { id, status: 'OPEN' },
    });
    return deleted.count === 1 ? id : null;
  }

  async claimByRange(
    providerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<AvailabilitySlot | null> {
    return this.prisma.runInTransaction(async (tx) => {
      // At most one slot can cover the window: slots never overlap.
      const candidate = await tx.availabilitySlot.findFirst({
        where: { providerId, status: 'OPEN', startAt: { lte: startAt }, endAt: { gte: endAt } },
        orderBy: { startAt: 'asc' },
      });
      if (!candidate) {
        return null;
      }

      // One conditional UPDATE: the row is locked, so a second claim finds
      // `status != 'OPEN'` and updates nothing.
      const claimed = await tx.availabilitySlot.updateMany({
        where: { id: candidate.id, status: 'OPEN' },
        data: { status: 'BOOKED' },
      });
      if (claimed.count !== 1) {
        return null;
      }

      return mapSlot({ ...candidate, status: 'BOOKED' });
    });
  }

  async releaseByRange(
    providerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<AvailabilitySlot | null> {
    const booked = await this.prisma.availabilitySlot.findFirst({
      where: { providerId, status: 'BOOKED', startAt: { lte: startAt }, endAt: { gte: endAt } },
      orderBy: { startAt: 'asc' },
    });
    if (!booked) {
      return null;
    }

    const released = await this.prisma.availabilitySlot.updateMany({
      where: { id: booked.id, status: 'BOOKED' },
      data: { status: 'OPEN' },
    });

    return released.count === 1 ? mapSlot({ ...booked, status: 'OPEN' }) : null;
  }
}

type SlotRow = {
  id: string;
  providerId: string;
  startAt: Date;
  endAt: Date;
  recurrenceRule: string | null;
  status: AvailabilityStatus;
};

function mapSlot(row: SlotRow): AvailabilitySlot {
  return {
    id: row.id,
    providerId: row.providerId,
    startAt: row.startAt,
    endAt: row.endAt,
    recurrenceRule: row.recurrenceRule,
    status: row.status,
  };
}
