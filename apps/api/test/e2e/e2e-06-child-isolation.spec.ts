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
  resetPlatform,
  type E2EHarness,
} from './helpers/e2e';

/**
 * E2E-06 — child isolation (`specs/14-test-strategy.md`):
 * parent A child cannot be read by parent B or provider not associated with
 * eligible order.
 */
describeWithDatabase('E2E-06 child isolation', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('keeps a child readable by its guardian only', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-06-admin');
    const parentA = await login(harness, 'e2e-06-parent-a');
    const parentB = await login(harness, 'e2e-06-parent-b');
    const mentor = await onboardMentor(harness, admin, 'e2e-06-mentor');

    const child = dataOf(
      await call<{ data: { id: string } }>(harness, 'POST', '/me/children', {
        token: parentA.token,
        body: { nickname: '小明', birthYear: 2_015, consentPolicyVersion: 'v1' },
      }),
      201,
    );

    // The guardian reads their own child.
    expect(
      await call(harness, 'GET', `/me/children/${child.id}`, { token: parentA.token }),
    ).toMatchObject({ status: 200 });

    // Another parent is denied — and denied without a single field of the child
    // (`specs/13`: no horizontal escalation, no child leakage).
    const stranger = await call(harness, 'GET', `/me/children/${child.id}`, {
      token: parentB.token,
    });
    expect([403, 404]).toContain(stranger.status);
    expect(JSON.stringify(stranger.body)).not.toContain('小明');

    // The provider of the marketplace sees no child at all.
    const provider = await call(harness, 'GET', `/me/children/${child.id}`, {
      token: mentor.owner.token,
    });
    expect([403, 404]).toContain(provider.status);
    expect(JSON.stringify(provider.body)).not.toContain('小明');

    // And no listing leaks it: anonymous access is refused outright.
    expect((await call(harness, 'GET', `/me/children/${child.id}`)).status).toBe(401);
    expect(
      dataOf(
        await call<{ data: { children: { id: string }[] } }>(harness, 'GET', '/me/children', {
          token: parentB.token,
        }),
      ).children,
    ).toEqual([]);
  });
});
