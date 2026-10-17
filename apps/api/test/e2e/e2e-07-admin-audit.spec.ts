import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  bootstrapAdmin,
  call,
  closeHarness,
  createHarness,
  dataOf,
  describeWithDatabase,
  onboardMentor,
  resetPlatform,
  type E2EHarness,
} from './helpers/e2e';

/**
 * E2E-07 — admin audit (`specs/14-test-strategy.md`):
 * admin action -> audit record exists.
 */
describeWithDatabase('E2E-07 admin audit', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('records every admin decision with its actor', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-07-admin');
    const mentor = await onboardMentor(harness, admin, 'e2e-07-mentor');

    // An admin decision: the provider is suspended with a reason (T019).
    const suspended = dataOf(
      await call<{ data: { approvalStatus: string } }>(
        harness,
        'POST',
        `/admin/providers/${mentor.providerId}/suspend`,
        { token: admin.token, body: { reason: '多起投诉待查' } },
      ),
      200,
    );
    expect(suspended.approvalStatus).toBe('SUSPENDED');

    // The audit record exists, names the actor and keeps the reason.
    const rows = await harness.prisma.auditLog.findMany({
      where: { resourceType: 'provider_profile', resourceId: mentor.providerId },
      orderBy: { createdAt: 'asc' },
    });
    const suspension = rows.find((row) => row.action === 'PROVIDER_SUSPENDED');
    expect(suspension).toBeDefined();
    expect(suspension?.actorUserId).toBe(admin.userId);
    expect(suspension?.actorType).toBe('ADMIN');
    expect(JSON.stringify(suspension?.afterJson)).toContain('多起投诉待查');
    // A request id links the row to the request that caused it.
    expect(suspension?.requestId).toBeTruthy();

    // …and the operations pages can read it back (T019).
    const logs = dataOf(
      await call<{ data: { items: { action: string; actorUserId: string | null }[] } }>(
        harness,
        'GET',
        '/admin/audit-logs?action=PROVIDER_SUSPENDED',
        { token: admin.token },
      ),
    );
    expect(logs.items.map((row) => row.action)).toContain('PROVIDER_SUSPENDED');
    expect(logs.items[0]?.actorUserId).toBe(admin.userId);

    // Restoring is audited too: no admin action is silent.
    await call(harness, 'POST', `/admin/providers/${mentor.providerId}/restore`, {
      token: admin.token,
      body: {},
    });
    const after = await harness.prisma.auditLog.findMany({
      where: { resourceType: 'provider_profile', resourceId: mentor.providerId },
    });
    expect(after.map((row) => row.action)).toContain('PROVIDER_RESTORED');
  });
});
