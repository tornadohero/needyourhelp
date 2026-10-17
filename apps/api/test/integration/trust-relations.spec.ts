import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createTestPrisma,
  describeWithDatabase,
  isUniqueConstraintError,
} from './helpers/test-database';

/**
 * Trust/commerce relationships the permission model depends on
 * (`specs/04-database-spec.md`, `specs/07-permission-spec.md`,
 * `specs/10-privacy-and-minors.md`):
 *
 * - one review per order/direction
 * - one block per user pair
 * - one moderation case per report
 * - privileged decisions are auditable with actor and before/after snapshot
 * - order money is stored as integer minor units and snapshots are preserved
 */
describeWithDatabase('permission data relationships: trust and commerce', () => {
  const prisma: PrismaClient = createTestPrisma();
  const suffix = randomUUID();
  const ids = { buyer: '', providerUser: '', providerProfile: '', service: '', order: '' };

  beforeAll(async () => {
    await prisma.$connect();

    const buyer = await prisma.user.create({
      data: { displayName: `trust-itest-buyer-${suffix}` },
    });
    const providerUser = await prisma.user.create({
      data: { displayName: `trust-itest-provider-${suffix}` },
    });
    const providerProfile = await prisma.providerProfile.create({
      data: { userId: providerUser.id, publicName: `trust-itest-${suffix}` },
    });
    const service = await prisma.service.create({
      data: {
        providerId: providerProfile.id,
        title: `trust-itest-service-${suffix}`,
        durationMinutes: 60,
        priceMinor: 10000,
        status: 'PUBLISHED',
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: `trust-itest-${suffix}`,
        buyerUserId: buyer.id,
        providerId: providerProfile.id,
        serviceId: service.id,
        status: 'COMPLETED',
        amountMinor: 10000,
        platformFeeMinor: 1000,
        providerAmountMinor: 9000,
        priceSnapshot: { priceMinor: 10000, currency: 'CNY' },
        policySnapshot: { cancellationPolicyId: 'policy-v1' },
      },
    });

    ids.buyer = buyer.id;
    ids.providerUser = providerUser.id;
    ids.providerProfile = providerProfile.id;
    ids.service = service.id;
    ids.order = order.id;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { orderId: ids.order } });
    await prisma.order.deleteMany({ where: { id: ids.order } });
    await prisma.service.deleteMany({ where: { id: ids.service } });
    await prisma.providerProfile.deleteMany({ where: { id: ids.providerProfile } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.buyer, ids.providerUser] } } });
    await prisma.$disconnect();
  });

  it('allows only one review per order and direction', async () => {
    const data = {
      orderId: ids.order,
      reviewerUserId: ids.buyer,
      revieweeUserId: ids.providerUser,
      rating: 5,
      content: 'great',
    };
    await prisma.review.create({ data });

    let error: unknown;
    try {
      await prisma.review.create({ data });
    } catch (caught) {
      error = caught;
    }

    expect(isUniqueConstraintError(error)).toBe(true);
    expect(await prisma.review.count({ where: { orderId: ids.order } })).toBe(1);

    await prisma.review.deleteMany({ where: { orderId: ids.order } });
  });

  it('allows only one block per user pair', async () => {
    await prisma.block.create({
      data: { blockerUserId: ids.buyer, blockedUserId: ids.providerUser },
    });

    let error: unknown;
    try {
      await prisma.block.create({
        data: { blockerUserId: ids.buyer, blockedUserId: ids.providerUser },
      });
    } catch (caught) {
      error = caught;
    }

    expect(isUniqueConstraintError(error)).toBe(true);

    await prisma.block.deleteMany({ where: { blockerUserId: ids.buyer } });
  });

  it('allows at most one moderation case per report and keeps the audit trail', async () => {
    const report = await prisma.report.create({
      data: {
        reporterUserId: ids.buyer,
        targetType: 'PROVIDER',
        targetId: ids.providerProfile,
        reasonCode: 'FAKE_CREDENTIALS',
      },
    });
    const openCase = await prisma.moderationCase.create({
      data: {
        sourceReportId: report.id,
        caseType: 'REPORT',
        targetType: 'PROVIDER',
        targetId: ids.providerProfile,
        status: 'OPEN',
        severity: 'HIGH',
        assignedModeratorId: ids.buyer,
      },
    });

    let duplicateError: unknown;
    try {
      await prisma.moderationCase.create({
        data: {
          sourceReportId: report.id,
          caseType: 'REPORT',
          targetType: 'PROVIDER',
          targetId: ids.providerProfile,
        },
      });
    } catch (caught) {
      duplicateError = caught;
    }
    expect(isUniqueConstraintError(duplicateError)).toBe(true);

    await prisma.moderationCase.update({
      where: { id: openCase.id },
      data: {
        status: 'RESOLVED',
        decision: 'RESTRICT_PROVIDER',
        decisionReason: 'credentials could not be verified',
        actionTaken: 'provider.searchable=false',
        beforeJson: { searchable: true },
        afterJson: { searchable: false },
      },
    });
    const resolved = await prisma.moderationCase.findUnique({ where: { id: openCase.id } });
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.beforeJson).toEqual({ searchable: true });
    expect(resolved?.afterJson).toEqual({ searchable: false });

    await prisma.auditLog.create({
      data: {
        actorUserId: ids.buyer,
        actorType: 'ADMIN',
        action: 'moderation.resolve',
        resourceType: 'moderation_case',
        resourceId: openCase.id,
        beforeJson: { status: 'OPEN' },
        afterJson: { status: 'RESOLVED' },
        requestId: 'req-itest',
      },
    });
    const audit = await prisma.auditLog.findMany({
      where: { resourceType: 'moderation_case', resourceId: openCase.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(ids.buyer);

    await prisma.auditLog.deleteMany({ where: { resourceId: openCase.id } });
    await prisma.moderationCase.deleteMany({ where: { id: openCase.id } });
    await prisma.report.deleteMany({ where: { id: report.id } });
  });

  it('records consent with policy version and revocation', async () => {
    await prisma.consent.create({
      data: {
        userId: ids.buyer,
        consentType: 'MINOR_GUARDIAN',
        policyVersion: 'v1.0',
        granted: true,
        grantedAt: new Date(),
        evidenceRef: 'itest-evidence',
      },
    });

    const consent = await prisma.consent.findFirst({
      where: { userId: ids.buyer, consentType: 'MINOR_GUARDIAN' },
    });
    expect(consent?.policyVersion).toBe('v1.0');
    expect(consent?.granted).toBe(true);
    expect(consent?.revokedAt).toBeNull();

    await prisma.consent.deleteMany({ where: { userId: ids.buyer } });
  });

  it('keeps order money as integers and preserves the price snapshot', async () => {
    const order = await prisma.order.findUnique({ where: { id: ids.order } });

    expect(Number.isInteger(order?.amountMinor)).toBe(true);
    expect(order?.amountMinor).toBe(10000);
    expect(order?.platformFeeMinor).toBe(1000);
    expect(order?.providerAmountMinor).toBe(9000);
    expect(order?.priceSnapshot).toEqual({ priceMinor: 10000, currency: 'CNY' });
    expect(order?.policySnapshot).toEqual({ cancellationPolicyId: 'policy-v1' });
  });
});
