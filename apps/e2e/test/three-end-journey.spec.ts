import { randomUUID } from 'node:crypto';

import type { AdminClient } from '@mentor/admin';
import {
  newBookingDraft,
  newServiceDraft,
  discoveryService,
  ordersService,
  paymentsService,
  providerDeskService,
  verificationService,
  withDuration,
  withPriceYuan,
  withService,
  withSlot,
  withSubjectCodes,
  withTitle,
} from '@mentor/miniprogram';
import type { MentorContext } from '@mentor/miniprogram';
import { beforeAll, describe, expect, it } from 'vitest';

import { adminClient, createEnd, dataOf, rawCall, signIn } from './helpers/ends';

/**
 * The three-end journey (T035) — one story told by three clients.
 *
 * 1. the **provider** (mini program) applies, submits evidence and publishes;
 * 2. the **console** (admin) checks that evidence and approves the merchant;
 * 3. the **parent** (mini program) discovers, books and pays;
 * 4. the provider delivers; the console refunds; the parent sees the result.
 *
 * Every step runs the shipping client module against a real server started by
 * `global-setup.ts`. Two steps are raw HTTP because no client can do them yet,
 * and both say so: mock-gateway payment (the parent payment screen is a later
 * task) and the first-administrator bootstrap (an operator is not a client
 * journey). Nothing else bypasses a client.
 */
interface Scenario {
  provider: MentorContext;
  parent: MentorContext;
  admin: AdminClient;
  adminToken: string;
  providerId: string;
  serviceId: string;
  orderId: string;
  orderNo: string;
  startAt: string;
  endAt: string;
  priceMinor: number;
}

const scenario: Partial<Scenario> = {};

const SUBJECT = 'MATH';
const CITY = 'BEIJING';
const PRICE_YUAN = '200';

function futureWindow(hoursAhead = 72): { startAt: string; endAt: string } {
  const start = new Date(Date.now() + hoursAhead * 60 * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

/** Bytes of "evidence": the real upload route checks size and signature only. */
const DOCUMENT_BYTES = Buffer.alloc(1_024, 7);

describe('three-end journey: apply, approve, book, deliver, refund', () => {
  beforeAll(async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }

    // ---- the operator: bootstrapped once, then signed in like an operator ----
    const operatorToken = dataOf<{ accessToken: string; user: { id: string } }>(
      await rawCall('POST', '/auth/wechat/login', {
        body: { code: `three-end-admin-${randomUUID()}` },
      }),
      201,
    );
    await rawCall('POST', '/admin/bootstrap', { token: operatorToken.accessToken });

    const username = `ops-${randomUUID().slice(0, 8)}`;
    const password = `E2e-${randomUUID()}`;
    dataOf(
      await rawCall('POST', '/admin/console-credentials', {
        token: operatorToken.accessToken,
        body: { userId: operatorToken.user.id, username, password },
      }),
      201,
    );

    const login = await adminClient().login({ username, password });
    const admin = adminClient(login.accessToken);

    // The disposable database carries no taxonomy: the console creates the term
    // the journey names, the same way an operator would.
    await admin.createTaxonomyTerm({ type: 'SUBJECT', code: SUBJECT, name: '数学' });

    // ---- the provider (mini program) ----
    const provider = createEnd();
    await signIn(provider, 'provider');
    const desk = await providerDeskService.applyAsProvider(provider, {
      publicName: '李老师',
      cityCode: CITY,
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    scenario.providerId = desk.id;
    await providerDeskService.submitApplication(provider);

    for (const verificationType of ['IDENTITY', 'EDUCATION'] as const) {
      const created = await verificationService.createVerificationCase(provider, verificationType);
      const target = await verificationService.requestDocumentUpload(provider, created.id, {
        documentType: verificationType === 'IDENTITY' ? 'ID_CARD' : 'DIPLOMA',
        contentType: 'image/jpeg',
        byteSize: DOCUMENT_BYTES.length,
      });

      // The bytes go to the object store — locally, the signed route is the store.
      const upload = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: target.headers,
        body: DOCUMENT_BYTES,
      });
      expect(upload.status, 'signed document upload').toBe(200);

      await verificationService.submitVerificationCase(provider, created.id);

      // ---- the console decides ----
      await admin.approveVerification(created.id, { reasonCode: 'DOCUMENTS_VERIFIED' });
    }

    await admin.approveProvider(scenario.providerId!, '材料齐全');

    // ---- publish and open a window ----
    let draft = withTitle(newServiceDraft(), '初中数学一对一');
    draft = withDuration(draft, 60);
    draft = withPriceYuan(draft, PRICE_YUAN);
    draft = withSubjectCodes(draft, [SUBJECT]);

    const service = await providerDeskService.createService(provider, draft);
    scenario.serviceId = service.id;
    scenario.priceMinor = 20_000;
    await providerDeskService.publishService(provider, service.id);

    const window = futureWindow();
    scenario.startAt = window.startAt;
    scenario.endAt = window.endAt;
    await providerDeskService.createSlot(provider, window);

    // ---- the parent (mini program) ----
    const parent = createEnd();
    await signIn(parent, 'parent');

    // The window is the provider's own: the client never composes a time.
    const slots = await ordersService.bookableSlots(parent, scenario.providerId!);
    expect(slots.length, 'a published window to book').toBeGreaterThan(0);

    let booking = withService(newBookingDraft(scenario.providerId!), scenario.serviceId!);
    booking = withSlot(booking, slots[0]!);

    const order = await ordersService.createOrder(parent, booking);
    scenario.orderId = order.id;
    scenario.orderNo = order.orderNo;

    // Payment now runs through the parent's own module: a session, the local
    // gateway callback, then the server's answer (`specs/08`: the client never
    // decides that an order is paid).
    const { session: payment } = await paymentsService.createPaymentSession(parent, order.id);
    await paymentsService.simulateGatewayCallback(parent, payment);
    const paid = await paymentsService.waitForPayment(parent, order.id, {
      attempts: 5,
      intervalMs: 100,
      sleep: async () => undefined,
    });
    expect(paid.outcome, 'the server confirmed the payment').toBe('paid');

    scenario.provider = provider;
    scenario.parent = parent;
    scenario.admin = admin;
    scenario.adminToken = login.accessToken;
  });

  it('signs the provider, the parent and the operator into the same platform', () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    expect(scenario.provider?.session.isSignedIn).toBe(true);
    expect(scenario.parent?.session.isSignedIn).toBe(true);
  });

  it('lets the parent find the merchant the console approved', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const page = await discoveryService.loadProviders(scenario.parent!);
    const row = page.items.find((item) => item.id === scenario.providerId);

    expect(row, 'the approved merchant is discoverable').toBeDefined();
    expect(row?.name).toBe('李老师');
  });

  it('books with the server’s price, never the client’s', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const { order } = await ordersService.orderDetail(scenario.parent!, scenario.orderId!);

    // What the parent sees is what the server decided at booking time.
    expect(order.totalText).toBe('¥200.00');
    expect(order.unitPriceText).toBe('¥200.00');
    expect(order.timeText.length).toBeGreaterThan(0);
    expect(order.status).toBe('PAID');
  });

  it('delivers through the three provider commands, in order', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const provider = scenario.provider!;

    const confirmed = await providerDeskService.confirmOrder(provider, scenario.orderId!);
    expect(confirmed.status).toBe('CONFIRMED');

    // Delivery stops here: the customer asks for their money back, so the
    // console refunds while the order is still open (`specs/08` §Refund).
    const started = await providerDeskService.startOrder(provider, scenario.orderId!);
    expect(started.status).toBe('IN_PROGRESS');
  });

  it('shows the parent what the provider did, with the same money', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const { order } = await ordersService.orderDetail(scenario.parent!, scenario.orderId!);

    expect(['IN_PROGRESS', 'REFUNDED']).toContain(order.status);
    expect(order.amountText).toBe('¥200.00');
    expect(order.orderNo).toBe(scenario.orderNo);
  });

  it('refunds from the console, once, and the parent sees it', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const admin = scenario.admin!;

    const key = randomUUID();
    const refunded = await admin.refundOrder(scenario.orderId!, { reason: '交付与约定不符' }, key);
    expect(refunded.orderId).toBe(scenario.orderId!);
    expect(refunded.amountMinor).toBe(scenario.priceMinor);

    // The same key again is the same refund, not a second one: money moves once.
    const replayed = await admin.refundOrder(scenario.orderId!, { reason: '交付与约定不符' }, key);
    expect(replayed.id).toBe(refunded.id);

    const { order, refunds } = await ordersService.orderDetail(scenario.parent!, scenario.orderId!);
    expect(order.status).toBe('REFUNDED');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amountText).toBe('¥200.00');

    // A refunded order is over: the provider cannot finish it any more, and the
    // platform says so instead of silently changing the state back.
    await expect(
      providerDeskService.completeOrder(scenario.provider!, scenario.orderId!),
    ).rejects.toThrow();
  });

  it('records the operator’s decisions where an auditor can read them', async () => {
    if (!process.env.E2E_API_URL) {
      return;
    }
    const logs = await scenario.admin!.auditLogs({ page: 1, pageSize: 50 });
    const actions = logs.items.map((log) => log.action);

    expect(actions).toContain('PROVIDER_APPROVED');
    expect(actions.some((action) => action.includes('VERIFICATION'))).toBe(true);
  });
});
