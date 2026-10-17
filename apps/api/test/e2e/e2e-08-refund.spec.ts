import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  bootstrapAdmin,
  call,
  closeHarness,
  createHarness,
  dataOf,
  describeWithDatabase,
  login,
  onboardMentor,
  payOrder,
  placeOrder,
  resetPlatform,
  type E2EHarness,
} from './helpers/e2e';

/**
 * E2E-08 — refund (`specs/14-test-strategy.md`):
 * paid order -> eligible refund -> refund success -> order/payment state
 * consistent.
 */
describeWithDatabase('E2E-08 refund', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('refunds a paid order and leaves the money consistent', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-08-admin');
    const parent = await login(harness, 'e2e-08-parent');
    const mentor = await onboardMentor(harness, admin, 'e2e-08-mentor');

    const order = await placeOrder(harness, parent, mentor);
    await payOrder(harness, parent, order, mentor.priceMinor);

    // The customer asks: the order enters the refund branch, no money moves yet.
    const requested = dataOf(
      await call<{ data: { orderStatus: string; refundableMinor: number } }>(
        harness,
        'POST',
        `/orders/${order.id}/refund-request`,
        { token: parent.token, body: { reason: '时间不合适' } },
      ),
      200,
    );
    expect(requested.orderStatus).toBe('REFUND_PENDING');
    // The server answers what it would refund; the client never says an amount.
    expect(requested.refundableMinor).toBe(mentor.priceMinor);
    expect(await harness.prisma.refund.count({ where: { orderId: order.id } })).toBe(0);

    // Only an admin moves money.
    const refund = dataOf(
      await call<{ data: { id: string; amountMinor: number; status: string } }>(
        harness,
        'POST',
        `/admin/orders/${order.id}/refund`,
        { token: admin.token, body: { reason: '家长要求' } },
      ),
      200,
    );
    expect(refund).toMatchObject({ amountMinor: mentor.priceMinor, status: 'SUCCEEDED' });

    // Order and payment stay consistent with the refund.
    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('REFUNDED');

    const payments = await harness.prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('SUCCEEDED');
    expect(payments[0]?.amountMinor).toBe(mentor.priceMinor);

    // Refunding more than was captured is impossible (T016).
    const again = await call(harness, 'POST', `/admin/orders/${order.id}/refund`, {
      token: admin.token,
      body: { amountMinor: 1 },
    });
    expect(again.status).toBe(409);
    expect(await harness.prisma.refund.count({ where: { orderId: order.id } })).toBe(1);

    // The customer sees the refund on their order.
    const listed = dataOf(
      await call<{ data: { items: { id: string; status: string }[] } }>(
        harness,
        'GET',
        `/orders/${order.id}/refunds`,
        { token: parent.token },
      ),
    );
    expect(listed.items.map((row) => row.id)).toContain(refund.id);

    // …and the admin refund was audited.
    const audit = await harness.prisma.auditLog.findMany({
      where: { resourceType: 'refund', resourceId: refund.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'REFUND_INITIATED', actorType: 'ADMIN' });
  });
});
