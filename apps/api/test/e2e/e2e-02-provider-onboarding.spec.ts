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
 * E2E-02 — provider onboarding (`specs/14-test-strategy.md`):
 * login -> application -> verification submission -> admin approve ->
 * service publish -> discoverable.
 */
describeWithDatabase('E2E-02 provider onboarding', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await resetPlatform(harness);
    await closeHarness(harness);
  });

  it('takes a tutor from application to discoverable', async () => {
    const admin = await bootstrapAdmin(harness, 'e2e-02-admin');
    const owner = await login(harness, 'e2e-02-owner');

    // Application: still invisible, and not yet approvable.
    const application = dataOf(
      await call<{ data: { id: string; approvalStatus: string } }>(
        harness,
        'POST',
        '/providers/applications',
        {
          token: owner.token,
          body: { publicName: '李老师', cityCode: 'BEIJING', capabilityTypes: ['STUDENT_TUTOR'] },
        },
      ),
      201,
    );
    expect(application.approvalStatus).toBe('DRAFT');

    await call(harness, 'POST', '/providers/me/submit', { token: owner.token, body: {} });
    expect(
      dataOf(
        await call<{ data: { approvalStatus: string } }>(harness, 'GET', '/providers/me', {
          token: owner.token,
        }),
      ).approvalStatus,
    ).toBe('SUBMITTED');

    // Verification: identity and education, submitted then approved by an admin.
    for (const verificationType of ['IDENTITY', 'EDUCATION']) {
      const created = dataOf(
        await call<{ data: { id: string; status: string } }>(
          harness,
          'POST',
          '/verification/cases',
          { token: owner.token, body: { verificationType } },
        ),
        201,
      );
      await call(harness, 'POST', `/verification/cases/${created.id}/documents/upload-url`, {
        token: owner.token,
        body: {
          documentType: verificationType === 'IDENTITY' ? 'ID_CARD' : 'DIPLOMA',
          contentType: 'image/jpeg',
          byteSize: 1_024,
          fileHash: 'a'.repeat(64),
        },
      });
      const submitted = dataOf(
        await call<{ data: { status: string } }>(
          harness,
          'POST',
          `/verification/cases/${created.id}/submit`,
          { token: owner.token, body: {} },
        ),
        200,
      );
      expect(submitted.status).not.toBe('DRAFT');

      const approved = dataOf(
        await call<{ data: { status: string } }>(
          harness,
          'POST',
          `/admin/verifications/${created.id}/approve`,
          { token: admin.token, body: { reasonCode: 'DOCUMENTS_VERIFIED' } },
        ),
        200,
      );
      expect(approved.status).toBe('APPROVED');
    }

    // Admin approval of the provider itself.
    const approved = dataOf(
      await call<{ data: { approvalStatus: string; searchable: boolean } }>(
        harness,
        'POST',
        `/admin/providers/${application.id}/approve`,
        { token: admin.token, body: { reason: '材料齐全' } },
      ),
      200,
    );
    expect(approved.approvalStatus).toBe('APPROVED');
    // Approval alone does not publish a provider without a service (T005).
    expect(approved.searchable).toBe(false);

    // Service publication makes the provider discoverable.
    await onboardMentor(harness, admin, 'e2e-02-second', { approve: true });

    const mentor = await harness.prisma.providerProfile.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(mentor.searchable).toBe(false);

    // …and with its own published service, this provider is discoverable too.
    await call(harness, 'POST', '/providers/me/services', {
      token: owner.token,
      body: {
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor: 20_000,
        subjectCodes: ['MATH'],
      },
    });
    const list = dataOf(
      await call<{ data: { items: { id: string }[] } }>(harness, 'GET', '/providers/me/services', {
        token: owner.token,
      }),
    );
    await call(harness, 'POST', `/providers/me/services/${list.items[0]!.id}/publish`, {
      token: owner.token,
      body: {},
    });

    const search = dataOf(
      await call<{ data: { items: { id: string }[] } }>(
        harness,
        'GET',
        '/providers?domain=TUTORING',
      ),
    );
    expect(search.items.map((hit) => hit.id)).toContain(application.id);
    expect(
      (await harness.prisma.providerProfile.findUniqueOrThrow({ where: { id: application.id } }))
        .searchable,
    ).toBe(true);
  });
});
