import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  bootstrapAdmin,
  call,
  closeHarness,
  createHarness,
  dataOf,
  describeWithDatabase,
  login,
  notifyPayment,
  onboardMentor,
  placeOrder,
  resetPlatform,
  type E2EHarness,
} from './helpers/e2e';

/**
 * E2E-05 — price tamper (`specs/14-test-strategy.md`):
 * client sends altered amount -> server rejects/uses server price.
 */
describeWithDatabase('E2E-05 price tamper', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('never books or charges an amount the client chose', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-05-admin');
    const parent = await login(harness, 'e2e-05-parent');
    const mentor = await onboardMentor(harness, admin, 'e2e-05-mentor', { priceMinor: 20_000 });

    // An amount in the booking payload is not a field the platform accepts.
    const tampered = await call(harness, 'POST', '/orders', {
      token: parent.token,
      body: {
        serviceId: mentor.serviceId,
        scheduledStart: mentor.startAt,
        scheduledEnd: mentor.endAt,
        amountMinor: 1,
      },
    });
    expect(tampered.status).toBe(400);

    // …and a cheaper price shape is not accepted either.
    const withPrice = await call(harness, 'POST', '/orders', {
      token: parent.token,
      body: {
        serviceId: mentor.serviceId,
        scheduledStart: mentor.startAt,
        scheduledEnd: mentor.endAt,
        priceMinor: 1,
      },
    });
    expect(withPrice.status).toBe(400);

    // The server's own price: the order is created for what the service costs.
    const order = await placeOrder(harness, parent, mentor);
    expect(
      dataOf(
        await call<{ data: { amountMinor: number } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).amountMinor,
    ).toBe(20_000);

    const session = dataOf(
      await call<{ data: { providerTransactionId: string; amountMinor: number } }>(
        harness,
        'POST',
        `/orders/${order.id}/payment-session`,
        { token: parent.token, body: {} },
      ),
      201,
    );
    expect(session.amountMinor).toBe(20_000);

    // A callback for a different amount never moves the order.
    await notifyPayment(harness, order, session.providerTransactionId, 1);
    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('PENDING_PAYMENT');

    // The right amount does.
    await notifyPayment(harness, order, session.providerTransactionId, 20_000);
    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('PAID');
  });
});
