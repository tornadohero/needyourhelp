import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaServiceRepository } from '../../src/modules/services/infrastructure/prisma-service.repository';
import { PrismaServiceReadiness } from '../../src/modules/services/infrastructure/prisma-service.readiness';
import { createTestPrismaService, describeWithDatabase, fixtureKey } from './helpers/test-database';

/**
 * Persistence of the T009 service aggregate against a real PostgreSQL database
 * (`specs/04-database-spec.md` §services / §service_terms).
 *
 * The tables are created by `prisma/migrations/20260929035555_init`; T009 adds
 * no migration, it only starts writing them.
 */
describeWithDatabase('service repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaServiceRepository;
  let readiness: PrismaServiceReadiness;

  const providerIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaServiceRepository(prisma);
    readiness = new PrismaServiceReadiness(prisma);
  });

  afterAll(async () => {
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerCapability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T009_' } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newProvider(): Promise<string> {
    const user = await prisma.user.create({ data: { displayName: fixtureKey('provider') } });
    userIds.push(user.id);

    const provider = await prisma.providerProfile.create({
      data: { userId: user.id, providerType: 'TUTORING', publicName: fixtureKey('name') },
    });
    providerIds.push(provider.id);
    return provider.id;
  }

  async function newTerm(
    type: 'SUBJECT' | 'GRADE' | 'SKILL' | 'CITY',
    code: string,
  ): Promise<string> {
    const term = await prisma.taxonomyTerm.create({
      data: { type, code, name: code },
    });
    return term.id;
  }

  it('creates a draft service with its taxonomy tags', async () => {
    const providerId = await newProvider();
    const math = await newTerm(
      'SUBJECT',
      `T009_${fixtureKey('MATH').replace(/-/g, '_').toUpperCase()}`,
    );
    const grade = await newTerm(
      'GRADE',
      `T009_${fixtureKey('GRADE').replace(/-/g, '_').toUpperCase()}`,
    );
    const city = await newTerm(
      'CITY',
      `T009_${fixtureKey('CITY').replace(/-/g, '_').toUpperCase()}`,
    );

    const created = await repository.create({
      providerId,
      domain: 'TUTORING',
      title: '数学一对一',
      description: '小学段',
      durationMinutes: 60,
      priceMinor: 20_000,
      currency: 'CNY',
      deliveryMode: 'ONLINE',
      termIds: [math, grade, city],
    });

    // A new service is never sellable: publishing is an explicit command.
    expect(created.status).toBe('DRAFT');
    expect(created.priceMinor).toBe(20_000);
    expect(created.durationMinutes).toBe(60);

    // `service_terms` holds ids; the adapter resolves them to codes.
    expect(await prisma.serviceTerm.count({ where: { serviceId: created.id } })).toBe(3);
    expect(created.terms.map((term) => term.type).sort()).toEqual(['CITY', 'GRADE', 'SUBJECT']);

    const storedCodes = await prisma.taxonomyTerm.findMany({
      where: { id: { in: [math, grade, city] } },
      select: { code: true },
    });
    const found = await repository.findById(created.id);
    expect(found?.terms.map((term) => term.code).sort()).toEqual(
      storedCodes.map((term) => term.code).sort(),
    );
    expect(await repository.findById('22222222-2222-4222-8222-222222222222')).toBeNull();
  });

  it('lists the services of one provider, newest first', async () => {
    const providerId = await newProvider();
    const other = await newProvider();
    const math = await newTerm(
      'SUBJECT',
      `T009_${fixtureKey('MATH').replace(/-/g, '_').toUpperCase()}`,
    );

    const first = await repository.create({
      providerId,
      domain: 'TUTORING',
      title: '第一节课',
      description: null,
      durationMinutes: 60,
      priceMinor: 10_000,
      currency: 'CNY',
      deliveryMode: 'ONLINE',
      termIds: [math],
    });
    await repository.create({
      providerId,
      domain: 'TUTORING',
      title: '第二节课',
      description: null,
      durationMinutes: 30,
      priceMinor: 8_000,
      currency: 'CNY',
      deliveryMode: 'OFFLINE',
      termIds: [math],
    });
    await repository.create({
      providerId: other,
      domain: 'TUTORING',
      title: '别人的课',
      description: null,
      durationMinutes: 30,
      priceMinor: 8_000,
      currency: 'CNY',
      deliveryMode: 'ONLINE',
      termIds: [math],
    });

    const mine = await repository.listByProvider(providerId);
    expect(mine).toHaveLength(2);
    expect(mine[0]?.id).toBeDefined();
    expect(mine.every((service) => service.providerId === providerId)).toBe(true);
    expect(mine.map((service) => service.title)).toContain(first.title);
  });

  it('updates fields and replaces the tags as a whole', async () => {
    const providerId = await newProvider();
    const math = await newTerm(
      'SUBJECT',
      `T009_${fixtureKey('MATH').replace(/-/g, '_').toUpperCase()}`,
    );
    const physics = await newTerm(
      'SUBJECT',
      `T009_${fixtureKey('PHY').replace(/-/g, '_').toUpperCase()}`,
    );

    const created = await repository.create({
      providerId,
      domain: 'TUTORING',
      title: '旧标题',
      description: '旧描述',
      durationMinutes: 60,
      priceMinor: 10_000,
      currency: 'CNY',
      deliveryMode: 'ONLINE',
      termIds: [math],
    });

    const updated = await repository.update(created.id, {
      title: '新标题',
      priceMinor: 12_000,
      termIds: [physics],
    });

    // Untouched fields are left alone.
    expect(updated.title).toBe('新标题');
    expect(updated.priceMinor).toBe(12_000);
    expect(updated.description).toBe('旧描述');
    expect(updated.durationMinutes).toBe(60);
    expect(updated.terms.map((term) => term.termId)).toEqual([physics]);
    expect(await prisma.serviceTerm.count({ where: { serviceId: created.id } })).toBe(1);

    const cleared = await repository.update(created.id, { description: null, termIds: [] });
    expect(cleared.description).toBeNull();
    expect(cleared.terms).toHaveLength(0);
  });

  it('publishes through setStatus and answers the discovery gate', async () => {
    const providerId = await newProvider();
    const math = await newTerm(
      'SUBJECT',
      `T009_${fixtureKey('MATH').replace(/-/g, '_').toUpperCase()}`,
    );

    const created = await repository.create({
      providerId,
      domain: 'TUTORING',
      title: '待发布',
      description: null,
      durationMinutes: 60,
      priceMinor: 10_000,
      currency: 'CNY',
      deliveryMode: 'ONLINE',
      termIds: [math],
    });

    expect(await readiness.hasPublishedService(providerId)).toBe(false);

    const published = await repository.setStatus(created.id, 'PUBLISHED');
    expect(published.status).toBe('PUBLISHED');
    expect(await readiness.hasPublishedService(providerId)).toBe(true);

    const unpublished = await repository.setStatus(created.id, 'UNPUBLISHED');
    expect(unpublished.status).toBe('UNPUBLISHED');
    expect(await readiness.hasPublishedService(providerId)).toBe(false);

    // Another provider without a published service never borrows the answer.
    const other = await newProvider();
    expect(await readiness.hasPublishedService(other)).toBe(false);
  });
});
