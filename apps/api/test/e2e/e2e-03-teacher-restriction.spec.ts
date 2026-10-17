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
  placeOrder,
  resetPlatform,
  type E2EHarness,
} from './helpers/e2e';

/**
 * E2E-03 — teacher restriction (`specs/14-test-strategy.md`):
 * teacher -> identity approved -> compliance pending -> not orderable ->
 * compliance approved -> orderable.
 */
describeWithDatabase('E2E-03 teacher restriction', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('keeps a teacher unorderable until compliance is approved', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-03-admin');
    const parent = await login(harness, 'e2e-03-parent');
    const mentor = await onboardMentor(harness, admin, 'e2e-03-teacher', {
      capabilityTypes: ['TEACHER'],
    });

    // The teacher capability starts its compliance review unfinished (T007).
    const capability = await harness.prisma.providerCapability.findFirstOrThrow({
      where: { providerId: mentor.providerId, capabilityType: 'TEACHER' },
    });
    expect(capability.complianceStatus).toBe('PENDING');

    // Not orderable: the order is refused and nothing is written.
    const refused = await call(harness, 'POST', '/orders', {
      token: parent.token,
      body: {
        serviceId: mentor.serviceId,
        scheduledStart: mentor.startAt,
        scheduledEnd: mentor.endAt,
      },
    });
    expect(refused.status).not.toBe(201);
    expect([403, 409]).toContain(refused.status);
    expect(await harness.prisma.order.count()).toBe(0);

    // Compliance approved by an admin.
    const queue = dataOf(
      await call<{ data: { items: { capabilityId: string }[] } }>(
        harness,
        'GET',
        '/admin/compliance',
        { token: admin.token },
      ),
    );
    const capabilityId = queue.items[0]?.capabilityId ?? capability.id;
    const approved = dataOf(
      await call<{ data: { complianceStatus: string } }>(
        harness,
        'POST',
        `/admin/compliance/${capabilityId}/approve`,
        { token: admin.token, body: { reasonCode: 'DOCUMENTS_VERIFIED' } },
      ),
      200,
    );
    expect(approved.complianceStatus).toBe('APPROVED');

    // Orderable now.
    const order = await placeOrder(harness, parent, mentor);
    expect(
      dataOf(
        await call<{ data: { status: string } }>(harness, 'GET', `/orders/${order.id}`, {
          token: parent.token,
        }),
      ).status,
    ).toBe('PENDING_PAYMENT');
  });
});
