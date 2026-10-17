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
 * E2E-04 — payment replay (`specs/14-test-strategy.md`):
 * same callback twice -> one successful state transition.
 */
describeWithDatabase('E2E-04 payment replay', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('applies a repeated callback once', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-04-admin');
    const parent = await login(harness, 'e2e-04-parent');
    const mentor = await onboardMentor(harness, admin, 'e2e-04-mentor');
    const order = await placeOrder(harness, parent, mentor);

    const session = dataOf(
      await call<{ data: { providerTransactionId: string } }>(
        harness,
        'POST',
        `/orders/${order.id}/payment-session`,
        { token: parent.token, body: {} },
      ),
      201,
    );

    const first = await notifyPayment(harness, order, session.providerTransactionId);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ applied: true, orderStatus: 'PAID' });

    // The gateway retries: the order must not move twice, and no second
    // successful payment may appear.
    const replay = await notifyPayment(harness, order, session.providerTransactionId);
    expect(replay.status).toBe(200);
    expect(replay.body.data.applied).toBe(false);

    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('PAID');

    const payments = await harness.prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('SUCCEEDED');
  });
});
