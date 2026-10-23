import type {
  AvailabilitySlotResponse,
  OrderResponse,
  MyVerificationResponse,
  ProviderProfileResponse,
  ProviderServiceListResponse,
  ServiceResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import {
  newServiceDraft,
  withDuration,
  withPriceYuan,
  withSubjectCodes,
  withTitle,
} from '../core/service-form';
import { MemoryTokenStore, SessionManager } from '../core/session';
import {
  applyAsProvider,
  completeOrder,
  confirmOrder,
  createService,
  createSlot,
  deleteSlot,
  listMyServices,
  listMySlots,
  myProviderProfile,
  myVerification,
  publishService,
  startOrder,
  submitApplication,
  unpublishService,
} from './provider-desk';

type Answer = { status: number; body: unknown };

function harness(answers: Answer[] = []) {
  const calls: TransportRequest[] = [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({ client, store });
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 4_102_444_800 });

  return { context: { client, session }, calls };
}

const PROFILE: ProviderProfileResponse = {
  id: 'provider-1',
  userId: 'user-1',
  providerType: 'TUTORING',
  publicName: '李老师',
  headline: null,
  bio: null,
  avatarVisibility: 'PUBLIC',
  cityCode: null,
  serviceMode: 'ONLINE',
  approvalStatus: 'APPROVED',
  searchable: true,
  ratingAvg: null,
  ratingCount: 0,
  completedOrderCount: 0,
  capabilities: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const SERVICE: ServiceResponse = {
  id: 'service-1',
  providerId: 'provider-1',
  domain: 'TUTORING',
  title: '初中数学一对一',
  description: null,
  durationMinutes: 60,
  priceMinor: 20_000,
  currency: 'CNY',
  deliveryMode: 'ONLINE',
  status: 'DRAFT',
  terms: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const SLOT: AvailabilitySlotResponse = {
  id: 'slot-1',
  providerId: 'provider-1',
  startAt: '2026-11-01T11:00:00.000Z',
  endAt: '2026-11-01T12:00:00.000Z',
  recurrenceRule: null,
  status: 'OPEN',
};

function ok(data: unknown): Answer {
  return { status: 200, body: { data } };
}

const ORDER: OrderResponse = {
  id: 'order-1',
  orderNo: 'MP202610210001',
  buyerUserId: 'user-9',
  providerId: 'provider-1',
  serviceId: 'service-1',
  childId: null,
  domain: 'TUTORING',
  status: 'PAID',
  amountMinor: 20_000,
  platformFeeMinor: 2_000,
  providerAmountMinor: 18_000,
  currency: 'CNY',
  scheduledStart: '2026-11-01T11:00:00.000Z',
  scheduledEnd: '2026-11-01T12:00:00.000Z',
  priceSnapshot: {
    serviceId: 'service-1',
    title: '初中数学一对一',
    priceMinor: 20_000,
    currency: 'CNY',
    durationMinutes: 60,
  },
  createdAt: '2026-10-21T02:00:00.000Z',
  updatedAt: '2026-10-21T02:00:00.000Z',
};

describe('myProviderProfile', () => {
  it('reads the provider’s own record, with the session attached', async () => {
    const { context, calls } = harness([ok(PROFILE)]);

    const desk = await myProviderProfile(context);

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/providers/me?providerType=TUTORING');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-1');
    expect(desk.approvalText).toBe('已通过');
  });
});

describe('myVerification', () => {
  it('reads only the provider’s own cases', async () => {
    const response: MyVerificationResponse = {
      providerId: 'provider-1',
      cases: [
        {
          id: 'case-1',
          providerId: 'provider-1',
          verificationType: 'IDENTITY',
          status: 'APPROVED',
          submittedAt: null,
          reviewedAt: null,
          decisionReason: null,
          documents: [],
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    };
    const { context, calls } = harness([ok(response)]);

    const cases = await myVerification(context);

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/verification/me');
    expect(cases[0]?.typeText).toBe('身份认证');
  });
});

describe('applyAsProvider', () => {
  it('posts display fields and identities, and nothing the server decides', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: PROFILE } }]);

    await applyAsProvider(context, {
      publicName: '李老师',
      capabilityTypes: ['TEACHER'],
    });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/providers/applications');
    const body = String(calls[0]?.body ?? '');
    expect(body).toContain('"publicName":"李老师"');
    for (const forbidden of ['approvalStatus', 'searchable', 'userId', 'roles']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('submitApplication', () => {
  it('is a command on the provider’s own record', async () => {
    const { context, calls } = harness([ok(PROFILE)]);

    await submitApplication(context);

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/submit?providerType=TUTORING',
    );
    expect(calls[0]?.body).toBeUndefined();
  });
});

describe('service management', () => {
  function services(...services: ServiceResponse[]): Answer {
    const body: ProviderServiceListResponse = { items: services, total: services.length };
    return ok(body);
  }

  it('lists the provider’s own services, drafts included', async () => {
    const { context, calls } = harness([services(SERVICE)]);

    const rows = await listMyServices(context);

    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/services?providerType=TUTORING',
    );
    expect(rows[0]?.statusText).toBe('草稿');
  });

  it('creates a service with integer minor units and term codes', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: SERVICE } }]);

    let draft = withTitle(newServiceDraft(), '初中数学一对一');
    draft = withDuration(draft, 60);
    draft = withPriceYuan(draft, '200');
    draft = withSubjectCodes(draft, ['MATH']);

    await createService(context, draft);

    const body = JSON.parse(String(calls[0]?.body));
    expect(body.priceMinor).toBe(20_000);
    expect(Number.isInteger(body.priceMinor)).toBe(true);
    expect(body.subjectCodes).toEqual(['MATH']);
  });

  it('publishes through the command, not by writing a status', async () => {
    const { context, calls } = harness([ok({ ...SERVICE, status: 'PUBLISHED' as const })]);

    const row = await publishService(context, 'service-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/services/service-1/publish?providerType=TUTORING',
    );
    expect(calls[0]?.body).toBeUndefined();
    expect(row.published).toBe(true);
  });

  it('unpublishes the same way', async () => {
    const { context, calls } = harness([ok({ ...SERVICE, status: 'UNPUBLISHED' as const })]);

    await unpublishService(context, 'service-1');

    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/services/service-1/unpublish?providerType=TUTORING',
    );
  });
});

describe('availability management', () => {
  it('lists the provider’s own open windows', async () => {
    const { context, calls } = harness([ok({ items: [SLOT], total: 1 })]);

    const slots = await listMySlots(context, 'provider-1');

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/providers/provider-1/availability');
    expect(slots[0]?.deletable).toBe(true);
  });

  it('offers a window without checking overlap: that rule is the server’s', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: SLOT } }]);

    await createSlot(context, {
      startAt: '2026-11-01T11:00:00.000Z',
      endAt: '2026-11-01T12:00:00.000Z',
    });

    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/availability?providerType=TUTORING',
    );
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      startAt: '2026-11-01T11:00:00.000Z',
      endAt: '2026-11-01T12:00:00.000Z',
    });
  });

  it('withdraws a window by id', async () => {
    const { context, calls } = harness([ok({ id: 'slot-1', deleted: true })]);

    const deleted = await deleteSlot(context, 'slot-1');

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers/me/availability/slot-1?providerType=TUTORING',
    );
    expect(deleted).toBe(true);
  });
});

describe('delivery commands', () => {
  it('accepts an order through the command route', async () => {
    const { context, calls } = harness([ok({ ...ORDER, status: 'CONFIRMED' as const })]);

    await confirmOrder(context, 'order-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/order-1/confirm');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('starts and finishes the same way', async () => {
    const started = harness([ok({ ...ORDER, status: 'IN_PROGRESS' as const })]);
    await startOrder(started.context, 'order-1');
    expect(started.calls[0]?.url).toBe('https://api.example.com/api/v1/orders/order-1/start');

    const finished = harness([ok({ ...ORDER, status: 'COMPLETED' as const })]);
    await completeOrder(finished.context, 'order-1');
    expect(finished.calls[0]?.url).toBe('https://api.example.com/api/v1/orders/order-1/complete');
  });
});
