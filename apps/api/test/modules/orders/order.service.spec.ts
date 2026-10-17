import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryIdempotencyStore } from '../../../src/common/idempotency/in-memory-idempotency.store';
import { IdempotencyConflictError } from '../../../src/common/idempotency/idempotency.store';
import type { AvailabilityService } from '../../../src/modules/availability/application/availability.service';
import type { TeacherComplianceService } from '../../../src/modules/compliance/application/teacher-compliance.service';
import type { ProviderServiceService } from '../../../src/modules/services/application/provider-service.service';
import type { ServiceFacts } from '../../../src/modules/services/domain/service.model';
import { OrderService } from '../../../src/modules/orders/application/order.service';
import { FakeChildProfileRepository, FakeOrderRepository } from './fakes';
import { DirectoryUserRepository, FakeProviderDirectory } from '../messaging/fakes';
import { FakeProviderCapabilityRepository, FakeProviderProfileRepository } from '../provider/fakes';

const BUYER = '11111111-1111-4111-8111-111111111111';
const PROVIDER_OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';
const CHILD_ID = '00000000-0000-4000-8000-0000000000cc';

const SLOT_START = new Date(Date.now() + 120 * 60_000);
const SLOT_END = new Date(Date.now() + 180 * 60_000);

function facts(overrides: Partial<ServiceFacts> = {}): ServiceFacts {
  return {
    id: SERVICE_ID,
    providerId: PROVIDER_ID,
    domain: 'TUTORING',
    title: '数学一对一',
    durationMinutes: 60,
    priceMinor: 20_000,
    currency: 'CNY',
    status: 'PUBLISHED',
    subjectCodes: ['MATH'],
    cityCode: 'BEIJING',
    ...overrides,
  };
}

interface BuildOptions {
  serviceFacts?: ServiceFacts;
  serviceError?: Error;
  discoverable?: boolean;
  capabilities?: { capabilityType: string; complianceStatus: string }[];
  complianceError?: Error;
  claimable?: boolean;
}

function build(options: BuildOptions = {}) {
  const orders = new FakeOrderRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const children = new FakeChildProfileRepository();
  const users = new DirectoryUserRepository({ [BUYER]: 'ACTIVE', [PROVIDER_OWNER]: 'ACTIVE' });
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const directory = new FakeProviderDirectory(
    options.discoverable !== false,
    PROVIDER_OWNER,
    PROVIDER_ID,
  );

  for (const capability of options.capabilities ?? [
    { capabilityType: 'STUDENT_TUTOR', complianceStatus: 'NOT_REQUIRED' },
  ]) {
    capabilities.capabilities.set(`${capability.capabilityType}-1`, {
      id: `${capability.capabilityType}-1`,
      providerId: PROVIDER_ID,
      capabilityType: capability.capabilityType as never,
      status: 'APPROVED',
      verificationLevel: 'FULL',
      complianceStatus: capability.complianceStatus as never,
      restrictionJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const complianceCalls: string[] = [];
  const released: { startAt: Date; endAt: Date }[] = [];
  let claimed = 0;

  const services = {
    assertOrderable: async () => {
      if (options.serviceError) {
        throw options.serviceError;
      }
      return options.serviceFacts ?? facts();
    },
  } as unknown as ProviderServiceService;

  const compliance = {
    assertOrderable: async (_providerId: string, capabilityType: string) => {
      complianceCalls.push(capabilityType);
      if (options.complianceError) {
        throw options.complianceError;
      }
      return {};
    },
  } as unknown as TeacherComplianceService;

  const availability = {
    claim: async () => {
      if (options.claimable === false) {
        throw new Error('unavailable');
      }
      claimed += 1;
      return { slotId: 'slot-1', providerId: PROVIDER_ID, startAt: SLOT_START, endAt: SLOT_END };
    },
    release: async (input: { startAt: Date; endAt: Date }) => {
      released.push(input);
      return true;
    },
  } as unknown as AvailabilityService;

  const service = new OrderService(
    orders,
    services,
    compliance,
    availability,
    directory,
    capabilities,
    profiles,
    users,
    children,
    idempotency,
  );

  return {
    service,
    orders,
    children,
    profiles,
    complianceCalls,
    released,
    claimCount: () => claimed,
  };
}

type Context = ReturnType<typeof build>;

const command = {
  serviceId: SERVICE_ID,
  scheduledStart: SLOT_START,
  scheduledEnd: SLOT_END,
};

describe('OrderService', () => {
  let ctx: Context;

  beforeEach(async () => {
    ctx = build();
    await ctx.children.add({ id: CHILD_ID, guardianUserId: BUYER });
  });

  it('places an order for the price the server calculates', async () => {
    const order = await ctx.service.create(BUYER, command);

    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.amountMinor).toBe(20_000);
    expect(order.platformFeeMinor).toBe(2_000);
    expect(order.providerAmountMinor).toBe(18_000);
    expect(order.currency).toBe('CNY');
    // The slot decides the schedule, not the client.
    expect(order.scheduledStart).toEqual(SLOT_START);
    expect(order.scheduledEnd).toEqual(SLOT_END);
    expect(order.priceSnapshot).toMatchObject({ serviceId: SERVICE_ID, priceMinor: 20_000 });
    expect(order.policySnapshot).toMatchObject({
      feeVersion: 'platform-fee-v1',
      feeRateBps: 1_000,
    });
    expect(ctx.claimCount()).toBe(1);
  });

  it('checks teacher compliance for every capability of the provider', async () => {
    ctx = build({
      capabilities: [
        { capabilityType: 'STUDENT_TUTOR', complianceStatus: 'NOT_REQUIRED' },
        { capabilityType: 'TEACHER', complianceStatus: 'APPROVED' },
      ],
    });

    await ctx.service.create(BUYER, command);

    expect(ctx.complianceCalls.sort()).toEqual(['STUDENT_TUTOR', 'TEACHER']);
  });

  it('refuses a service that is not published', async () => {
    const { serviceNotPublished } =
      await import('../../../src/modules/services/domain/service.errors');
    ctx = build({ serviceError: serviceNotPublished() });

    await expect(ctx.service.create(BUYER, command)).rejects.toMatchObject({
      code: 'SERVICE_NOT_PUBLISHED',
      status: 409,
    });
    expect(ctx.claimCount()).toBe(0);
  });

  it('refuses a provider that is not discoverable', async () => {
    ctx = build({ discoverable: false });

    await expect(ctx.service.create(BUYER, command)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(ctx.claimCount()).toBe(0);
  });

  it('refuses ordering your own service and an inactive buyer', async () => {
    await expect(ctx.service.create(PROVIDER_OWNER, command)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const inactive = new DirectoryUserRepository({ [BUYER]: 'SUSPENDED' });
    const other = new OrderService(
      ctx.orders,
      { assertOrderable: async () => facts() } as never,
      { assertOrderable: async () => ({}) } as never,
      {
        claim: async () => ({
          slotId: 's',
          providerId: PROVIDER_ID,
          startAt: SLOT_START,
          endAt: SLOT_END,
        }),
      } as never,
      new FakeProviderDirectory(true, PROVIDER_OWNER, PROVIDER_ID),
      new FakeProviderCapabilityRepository(),
      new FakeProviderProfileRepository(),
      inactive,
      ctx.children,
      new InMemoryIdempotencyStore(),
    );
    await expect(other.create(BUYER, command)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(inactive).toBeDefined();
  });

  it('refuses a child that is not the buyer’s', async () => {
    await expect(
      ctx.service.create(BUYER, { ...command, childId: '44444444-4444-4444-8444-444444444444' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await ctx.children.add({
      id: '55555555-5555-4555-8555-555555555555',
      guardianUserId: STRANGER,
    });
    await expect(
      ctx.service.create(BUYER, { ...command, childId: '55555555-5555-4555-8555-555555555555' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create(BUYER, { ...command, childId: CHILD_ID }),
    ).resolves.toMatchObject({ childId: CHILD_ID });
  });

  it('refuses a compliance decision that blocks the service', async () => {
    const { complianceNotPermitted } =
      await import('../../../src/modules/compliance/domain/compliance.errors');
    ctx = build({ complianceError: complianceNotPermitted() });

    await expect(ctx.service.create(BUYER, command)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(ctx.claimCount()).toBe(0);
  });

  it('gives the slot back when the order cannot be written', async () => {
    ctx.orders.failNextCreate = true;

    await expect(ctx.service.create(BUYER, command)).rejects.toThrow(/database unavailable/);
    expect(ctx.released).toHaveLength(1);
  });

  it('replays a retried create and refuses a reused key with another payload', async () => {
    const first = await ctx.service.create(BUYER, command, 'key-1');
    const replay = await ctx.service.create(BUYER, command, 'key-1');

    expect(replay.id).toBe(first.id);
    // Nothing extra was claimed or written.
    expect(ctx.claimCount()).toBe(1);
    expect(ctx.orders.orders.size).toBe(1);

    await expect(
      ctx.service.create(BUYER, { ...command, childId: CHILD_ID }, 'key-1'),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('lists and reads orders only for the parties of the order', async () => {
    const order = await ctx.service.create(BUYER, command);

    // The provider owner sees it through their provider profile.
    ctx.profiles.profiles.set(PROVIDER_ID, {
      id: PROVIDER_ID,
      userId: PROVIDER_OWNER,
      providerType: 'TUTORING',
      publicName: '李老师',
      headline: null,
      bio: null,
      avatarVisibility: 'PRIVATE',
      avatarAssetId: null,
      cityCode: 'BEIJING',
      serviceMode: 'ONLINE',
      approvalStatus: 'APPROVED',
      searchable: true,
      ratingAvg: null,
      ratingCount: 0,
      completedOrderCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect((await ctx.service.listMine(BUYER)).total).toBe(1);
    expect((await ctx.service.listMine(PROVIDER_OWNER)).total).toBe(1);
    expect((await ctx.service.listMine(STRANGER)).total).toBe(0);

    await expect(ctx.service.getForParticipant(PROVIDER_OWNER, order.id)).resolves.toMatchObject({
      id: order.id,
    });
    for (const id of [order.id, '66666666-6666-4666-8666-666666666666', 'not-a-uuid']) {
      await expect(ctx.service.getForParticipant(STRANGER, id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
  });

  it('moves the state through commands, and only for the right party', async () => {
    const order = await ctx.service.create(BUYER, command);
    ctx.profiles.profiles.set(PROVIDER_ID, {
      id: PROVIDER_ID,
      userId: PROVIDER_OWNER,
      providerType: 'TUTORING',
      publicName: '李老师',
      headline: null,
      bio: null,
      avatarVisibility: 'PRIVATE',
      avatarAssetId: null,
      cityCode: 'BEIJING',
      serviceMode: 'ONLINE',
      approvalStatus: 'APPROVED',
      searchable: true,
      ratingAvg: null,
      ratingCount: 0,
      completedOrderCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // The provider cannot confirm an unpaid order: the transition is illegal.
    await expect(ctx.service.runCommand(PROVIDER_OWNER, order.id, 'confirm')).rejects.toMatchObject(
      {
        code: 'ORDER_INVALID_STATE',
        status: 409,
      },
    );

    // `PAID` is written by the payment context (T014); tests set it directly.
    await ctx.orders.setStatus(order.id, 'PAID');

    // The buyer may not move the order forward.
    await expect(ctx.service.runCommand(BUYER, order.id, 'confirm')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    expect((await ctx.service.runCommand(PROVIDER_OWNER, order.id, 'confirm')).status).toBe(
      'CONFIRMED',
    );
    expect((await ctx.service.runCommand(PROVIDER_OWNER, order.id, 'start')).status).toBe(
      'IN_PROGRESS',
    );
    expect((await ctx.service.runCommand(PROVIDER_OWNER, order.id, 'complete')).status).toBe(
      'COMPLETED',
    );

    // Completion is what discovery ranks on and what unlocks reviews (T017):
    // the delivered session is counted exactly once.
    const completed = await ctx.profiles.findById(order.providerId);
    expect(completed?.completedOrderCount).toBe(1);

    // Completed is terminal.
    await expect(
      ctx.service.runCommand(PROVIDER_OWNER, order.id, 'complete'),
    ).rejects.toMatchObject({ code: 'ORDER_INVALID_STATE' });
  });

  it('lets only the buyer cancel an unpaid order, and frees the slot', async () => {
    const order = await ctx.service.create(BUYER, command);

    await expect(ctx.service.runCommand(STRANGER, order.id, 'cancel')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const cancelled = await ctx.service.runCommand(BUYER, order.id, 'cancel');
    expect(cancelled.status).toBe('CANCELLED');
    // The time is bookable again.
    expect(ctx.released).toHaveLength(1);
  });

  it('refuses to cancel an order that is already paid', async () => {
    const order = await ctx.service.create(BUYER, command);
    await ctx.orders.setStatus(order.id, 'PAID');

    await expect(ctx.service.runCommand(BUYER, order.id, 'cancel')).rejects.toMatchObject({
      code: 'ORDER_INVALID_STATE',
      status: 409,
    });
  });
});
