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
 * E2E-01 — parent tutoring (`specs/14-test-strategy.md`):
 * login -> create child -> search -> provider detail -> create order ->
 * payment mock success -> confirm -> complete -> review.
 */
describeWithDatabase('E2E-01 parent tutoring', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('books, pays, completes and reviews a tutoring session', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-01-admin');
    const parent = await login(harness, 'e2e-01-parent');
    const mentor = await onboardMentor(harness, admin, 'e2e-01-mentor');

    // The child is created by the guardian, with consent (T004).
    const child = dataOf(
      await call<{ data: { id: string; nickname: string } }>(harness, 'POST', '/me/children', {
        token: parent.token,
        body: { nickname: '小明', birthYear: 2_015, consentPolicyVersion: 'v1' },
      }),
      201,
    );
    expect(child.nickname).toBe('小明');

    // Discovery: the mentor is findable and readable.
    const search = dataOf(
      await call<{ data: { items: { id: string }[] } }>(
        harness,
        'GET',
        '/providers?domain=TUTORING',
      ),
    );
    expect(search.items.map((hit) => hit.id)).toContain(mentor.providerId);

    const detail = dataOf(
      await call<{ data: { id: string } }>(harness, 'GET', `/providers/${mentor.providerId}`),
    );
    expect(detail.id).toBe(mentor.providerId);

    // Booking, for the child, at the price the server calculated.
    const order = await placeOrder(harness, parent, mentor, { childId: child.id });
    const created = dataOf(
      await call<{ data: { status: string; amountMinor: number; childId: string | null } }>(
        harness,
        'GET',
        `/orders/${order.id}`,
        { token: parent.token },
      ),
    );
    expect(created).toMatchObject({
      status: 'PENDING_PAYMENT',
      amountMinor: mentor.priceMinor,
      childId: child.id,
    });

    // Payment through the mock gateway.
    await payOrder(harness, parent, order, mentor.priceMinor);
    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('PAID');

    // Delivery: only the provider moves the order.
    for (const command of ['confirm', 'start', 'complete']) {
      const response = await call<{ data: { status: string } }>(
        harness,
        'POST',
        `/orders/${order.id}/${command}`,
        { token: mentor.owner.token, body: {} },
      );
      if (response.status !== 200) {
        throw new Error(`${command}: ${response.status} ${JSON.stringify(response.body)}`);
      }
    }

    // Review: only after the session was delivered (T017).
    const review = dataOf(
      await call<{ data: { rating: number; content: string | null } }>(
        harness,
        'POST',
        `/orders/${order.id}/reviews`,
        { token: parent.token, body: { rating: 5, content: '讲得很清楚' } },
      ),
      201,
    );
    expect(review.rating).toBe(5);

    // The completion and the review are what discovery ranks on.
    const profile = await harness.prisma.providerProfile.findUniqueOrThrow({
      where: { id: mentor.providerId },
    });
    expect(profile.completedOrderCount).toBe(1);
    expect(profile.ratingCount).toBe(1);
    expect(Number(profile.ratingAvg)).toBe(5);
  });
});
