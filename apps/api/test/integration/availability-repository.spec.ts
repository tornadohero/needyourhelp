import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaAvailabilitySlotRepository } from '../../src/modules/availability/infrastructure/prisma-availability-slot.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Availability persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §availability_slots, T011 acceptance).
 *
 * The race tests are the point of this file: two concurrent claims of the same
 * window must produce exactly one winner, and two concurrent inserts of
 * overlapping windows must produce exactly one slot.
 */
describeWithDatabase('availability slot repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaAvailabilitySlotRepository;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let providerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaAvailabilitySlotRepository(prisma);

    const user = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(user.id);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
      },
    });
    providerIds.push(provider.id);
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.availabilitySlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /**
   * One window, computed once.
   *
   * A booking sends the exact boundaries of the slot it read, so a test must not
   * recompute `now` between create and claim.
   */
  function window(startMinutes: number, endMinutes: number) {
    const base = Date.now();
    return {
      startAt: new Date(base + startMinutes * 60_000),
      endAt: new Date(base + endMinutes * 60_000),
    };
  }

  async function newSlot(startAt: Date, endAt: Date, recurrenceRule: string | null = null) {
    return repository.create({ providerId, startAt, endAt, recurrenceRule });
  }

  it('creates, reads and lists slots', async () => {
    const first = window(60, 120);
    const created = await newSlot(first.startAt, first.endAt, 'FREQ=WEEKLY;BYDAY=MO');

    expect(created.status).toBe('OPEN');
    expect((await repository.findById(created.id))?.id).toBe(created.id);
    expect(await repository.findById('22222222-2222-4222-8222-222222222222')).toBeNull();

    const all = await repository.listByProvider(providerId);
    expect(all.map((slot) => slot.id)).toContain(created.id);

    // A filter never widens the answer: an open slot is not a booked one.
    const booked = await repository.listByProvider(providerId, {
      statuses: ['BOOKED'],
      from: new Date(),
      limit: 10,
    });
    expect(booked.map((slot) => slot.id)).not.toContain(created.id);
  });

  it('refuses an overlapping slot, in the application and in the database', async () => {
    const first = window(600, 660);
    const created = await newSlot(first.startAt, first.endAt);

    const partial = window(630, 690);
    await expect(newSlot(partial.startAt, partial.endAt)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    // Touching windows are free.
    const touching = window(660, 720);
    await expect(newSlot(touching.startAt, touching.endAt)).resolves.toMatchObject({
      status: 'OPEN',
    });

    // Even bypassing the repository: the exclusion constraint holds.
    const raw = window(610, 650);
    await expect(
      prisma.availabilitySlot.create({
        data: { providerId, startAt: raw.startAt, endAt: raw.endAt, status: 'OPEN' },
      }),
    ).rejects.toThrow();

    expect(created.status).toBe('OPEN');
  });

  it('lets exactly one of two concurrent overlapping creates win', async () => {
    const before = await prisma.availabilitySlot.count({ where: { providerId } });
    const first = window(3000, 3060);
    const second = window(3030, 3090);

    const results = await Promise.allSettled([
      newSlot(first.startAt, first.endAt),
      newSlot(second.startAt, second.endAt),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    // The loser is refused, never stored: one slot, not two overlapping ones.
    expect(await prisma.availabilitySlot.count({ where: { providerId } })).toBe(before + 1);
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const booked = window(1200, 1260);
    const slot = await newSlot(booked.startAt, booked.endAt);

    const results = await Promise.all([
      repository.claimByRange(providerId, booked.startAt, booked.endAt),
      repository.claimByRange(providerId, booked.startAt, booked.endAt),
    ]);

    const winners = results.filter((claimed) => claimed !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(slot.id);
    expect(winners[0]?.status).toBe('BOOKED');

    // A third, later attempt finds nothing bookable: the slot is taken.
    expect(await repository.claimByRange(providerId, booked.startAt, booked.endAt)).toBeNull();

    // A window no slot covers is never bookable.
    const uncovered = window(5000, 5060);
    expect(
      await repository.claimByRange(providerId, uncovered.startAt, uncovered.endAt),
    ).toBeNull();
  });

  it('releases a booked window back to open', async () => {
    const booked = window(1500, 1560);
    const slot = await newSlot(booked.startAt, booked.endAt);

    expect(await repository.claimByRange(providerId, booked.startAt, booked.endAt)).not.toBeNull();

    const released = await repository.releaseByRange(providerId, booked.startAt, booked.endAt);
    expect(released?.id).toBe(slot.id);
    expect(released?.status).toBe('OPEN');

    // Released, so it can be booked again.
    expect(await repository.claimByRange(providerId, booked.startAt, booked.endAt)).not.toBeNull();

    // Releasing a window that is not booked does nothing.
    const open = window(1800, 1860);
    await newSlot(open.startAt, open.endAt);
    expect(await repository.releaseByRange(providerId, open.startAt, open.endAt)).toBeNull();
  });

  it('deletes an open slot only', async () => {
    const open = window(2100, 2160);
    const openSlot = await newSlot(open.startAt, open.endAt);

    expect(await repository.deleteIfOpen(openSlot.id)).toBe(openSlot.id);
    expect(await repository.findById(openSlot.id)).toBeNull();
    expect(await repository.deleteIfOpen(openSlot.id)).toBeNull();

    const booked = window(2400, 2460);
    const bookedSlot = await newSlot(booked.startAt, booked.endAt);
    await repository.claimByRange(providerId, booked.startAt, booked.endAt);

    // A confirmed booking keeps its slot.
    expect(await repository.deleteIfOpen(bookedSlot.id)).toBeNull();
    expect(await repository.findById(bookedSlot.id)).not.toBeNull();
  });
});
