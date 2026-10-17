import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeFeatureFlagRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  TrackingUserRepository,
} from '../provider/fakes';
import { ProviderApplicationService } from '../../../src/modules/provider/application/provider-application.service';
import { FakeAvailabilitySlotRepository, FakeDiscoverableDirectory } from './fakes';
import { AvailabilityService } from '../../../src/modules/availability/application/availability.service';

function build(options: { discoverable?: boolean } = {}) {
  const slots = new FakeAvailabilitySlotRepository();
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const flags = new FakeFeatureFlagRepository({});
  const users = new TrackingUserRepository();
  const directory = new FakeDiscoverableDirectory(options.discoverable !== false);
  const applications = new ProviderApplicationService(
    profiles,
    capabilities,
    flags,
    // The provider service needs the gates; availability never calls them.
    { verificationSatisfied: async () => true, hasPublishedService: async () => true },
    users,
  );
  const service = new AvailabilityService(slots, applications, directory);

  return { service, slots, profiles, users, applications };
}

type Context = ReturnType<typeof build>;

async function newProvider(ctx: Context): Promise<{ userId: string; providerId: string }> {
  const user = await ctx.users.create({ displayName: '老师' });
  const application = await ctx.applications.createApplication(user.id, {
    providerType: 'TUTORING',
    publicName: '李老师',
    capabilityTypes: ['STUDENT_TUTOR'],
  });
  return { userId: user.id, providerId: application.profile.id };
}

function future(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

describe('AvailabilityService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('creates an open slot for the provider behind the session', async () => {
    const { userId, providerId } = await newProvider(ctx);

    const slot = await ctx.service.createSlot(userId, 'TUTORING', {
      startAt: future(60),
      endAt: future(120),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    expect(slot.providerId).toBe(providerId);
    expect(slot.status).toBe('OPEN');
    expect(slot.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('validates the window server-side', async () => {
    const { userId } = await newProvider(ctx);

    for (const invalid of [
      { startAt: future(120), endAt: future(60) },
      { startAt: future(60), endAt: future(70) },
      { startAt: future(-60), endAt: future(60) },
    ]) {
      await expect(
        ctx.service.createSlot(userId, 'TUTORING', invalid),
        JSON.stringify(invalid),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
  });

  it('refuses a slot that overlaps an existing one', async () => {
    const { userId } = await newProvider(ctx);

    await ctx.service.createSlot(userId, 'TUTORING', {
      startAt: future(60),
      endAt: future(120),
    });

    for (const overlapping of [
      { startAt: future(90), endAt: future(150) },
      { startAt: future(30), endAt: future(90) },
      { startAt: future(0), endAt: future(300) },
    ]) {
      await expect(
        ctx.service.createSlot(userId, 'TUTORING', overlapping),
        JSON.stringify(overlapping),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }

    // Touching windows are allowed.
    await expect(
      ctx.service.createSlot(userId, 'TUTORING', { startAt: future(120), endAt: future(180) }),
    ).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('lists only future open slots of a discoverable provider', async () => {
    // A public id is opaque, so the fake uses a uuid-shaped one.
    const providerId = '00000000-0000-4000-8000-000000000001';
    const slots = ctx.slots;
    const first = await slots.create({
      providerId,
      startAt: future(60),
      endAt: future(120),
      recurrenceRule: null,
    });
    const second = await slots.create({
      providerId,
      startAt: future(180),
      endAt: future(240),
      recurrenceRule: null,
    });
    // Booked and past slots are not bookable and never shown.
    await slots.forceStatus(second.id, 'BOOKED');
    const past = await slots.create({
      providerId,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2020-01-01T01:00:00.000Z'),
      recurrenceRule: null,
    });

    const listed = await ctx.service.listBookable(providerId);

    expect(listed.map((slot) => slot.id)).toEqual([first.id]);
    expect(listed).not.toContainEqual(expect.objectContaining({ id: past.id }));
  });

  it('hides the availability of a provider that is not discoverable', async () => {
    ctx = build({ discoverable: false });

    await expect(
      ctx.service.listBookable('11111111-1111-4111-8111-111111111111'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(ctx.service.listBookable('not-a-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('deletes an own open slot only', async () => {
    const { userId } = await newProvider(ctx);
    const slot = await ctx.service.createSlot(userId, 'TUTORING', {
      startAt: future(60),
      endAt: future(120),
    });

    await expect(ctx.service.deleteSlot(userId, 'TUTORING', slot.id)).resolves.toBe(slot.id);
    expect(await ctx.slots.findById(slot.id)).toBeNull();

    // Gone, so a second delete is simply not found.
    await expect(ctx.service.deleteSlot(userId, 'TUTORING', slot.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps the slot of a confirmed booking', async () => {
    const { userId, providerId } = await newProvider(ctx);
    const slot = await ctx.service.createSlot(userId, 'TUTORING', {
      startAt: future(60),
      endAt: future(120),
    });
    await ctx.slots.claimByRange(providerId, future(60), future(120));

    await expect(ctx.service.deleteSlot(userId, 'TUTORING', slot.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(await ctx.slots.findById(slot.id)).not.toBeNull();
  });

  it('refuses another provider slot and unknown ids', async () => {
    const owner = await newProvider(ctx);
    const other = await newProvider(ctx);
    const slot = await ctx.service.createSlot(owner.userId, 'TUTORING', {
      startAt: future(60),
      endAt: future(120),
    });

    await expect(ctx.service.deleteSlot(other.userId, 'TUTORING', slot.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    for (const id of ['22222222-2222-4222-8222-222222222222', 'not-a-uuid']) {
      await expect(ctx.service.deleteSlot(owner.userId, 'TUTORING', id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
  });

  it('lets exactly one of two concurrent bookings win', async () => {
    const { providerId } = await newProvider(ctx);
    await ctx.slots.create({
      providerId,
      startAt: future(60),
      endAt: future(120),
      recurrenceRule: null,
    });

    const results = await Promise.allSettled([
      ctx.service.claim({ providerId, startAt: future(60), endAt: future(120) }),
      ctx.service.claim({ providerId, startAt: future(60), endAt: future(120) }),
    ]);

    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // The loser is told the time is taken, never that it may double-book.
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('claims a window only when a slot covers it, and releases it back', async () => {
    const { providerId } = await newProvider(ctx);
    // Computed once: a window recomputed later would drift past the slot end and
    // make the "covered by a slot" check depend on how fast the test ran.
    const slotStart = future(60);
    const slotEnd = future(120);
    const elsewhereStart = future(600);
    const elsewhereEnd = future(660);

    await ctx.slots.create({
      providerId,
      startAt: slotStart,
      endAt: slotEnd,
      recurrenceRule: null,
    });

    // Outside every slot: nothing to book.
    await expect(
      ctx.service.claim({ providerId, startAt: elsewhereStart, endAt: elsewhereEnd }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const booking = await ctx.service.claim({
      providerId,
      startAt: slotStart,
      endAt: slotEnd,
    });
    expect(booking.slotId).toBeDefined();

    // Already booked: a second booking of the same time is refused.
    await expect(
      ctx.service.claim({ providerId, startAt: slotStart, endAt: slotEnd }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // A cancellation gives the window back (T016).
    expect(await ctx.service.release({ providerId, startAt: slotStart, endAt: slotEnd })).toBe(
      true,
    );
    await expect(
      ctx.service.claim({ providerId, startAt: slotStart, endAt: slotEnd }),
    ).resolves.toMatchObject({ slotId: booking.slotId });
  });
});
