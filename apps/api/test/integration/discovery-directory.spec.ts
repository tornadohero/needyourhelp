import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaProviderDirectory } from '../../src/modules/discovery/infrastructure/prisma-provider.directory';
import type { ProviderSearchQuery } from '../../src/modules/discovery/domain/provider-search.model';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * The discovery read model against a real PostgreSQL database
 * (`specs/01-business-rules.md` §Provider approval, `specs/14-test-strategy.md`).
 *
 * The acceptance criterion of T010 is enforced here: whatever the filters are,
 * a provider that the platform decided to hide can never appear.
 */
describeWithDatabase('provider directory (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let directory: PrismaProviderDirectory;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  const MATH = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const PHYSICS = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const GRADE_1 = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const GRADE_2 = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;

  /** The discoverable math tutor in Beijing. */
  let visible: string;
  /** The discoverable physics tutor in Shanghai, unverified. */
  let other: string;
  /** Approved but not searchable: a gate is still closed. */
  let hidden: string;
  /** Searchable, but the account is suspended. */
  let suspendedAccount: string;

  beforeAll(async () => {
    await prisma.$connect();
    directory = new PrismaProviderDirectory(prisma, new PrismaFeatureFlagRepository(prisma));

    await prisma.taxonomyTerm.createMany({
      data: [
        { type: 'SUBJECT', code: MATH, name: '数学' },
        { type: 'SUBJECT', code: PHYSICS, name: '物理' },
        { type: 'GRADE', code: GRADE_1, name: '一年级' },
        { type: 'GRADE', code: GRADE_2, name: '二年级' },
      ],
    });

    visible = await newProvider({
      searchable: true,
      approvalStatus: 'APPROVED',
      cityCode: 'BEIJING',
      userStatus: 'ACTIVE',
      rating: [4.5, 12],
      capability: { capabilityType: 'STUDENT_TUTOR', verificationLevel: 'FULL' },
      services: [
        { title: '数学', priceMinor: 20_000, deliveryMode: 'ONLINE', codes: [MATH, GRADE_1] },
        { title: '数学小班', priceMinor: 9_000, deliveryMode: 'ONLINE', codes: [MATH, GRADE_2] },
      ],
    });

    other = await newProvider({
      searchable: true,
      approvalStatus: 'APPROVED',
      cityCode: 'SHANGHAI',
      userStatus: 'ACTIVE',
      rating: [5, 40],
      capability: { capabilityType: 'TEACHER', verificationLevel: 'NONE' },
      services: [
        { title: '物理', priceMinor: 50_000, deliveryMode: 'OFFLINE', codes: [PHYSICS, GRADE_2] },
      ],
    });

    hidden = await newProvider({
      searchable: false,
      approvalStatus: 'APPROVED',
      cityCode: 'BEIJING',
      userStatus: 'ACTIVE',
      rating: [5, 99],
      capability: { capabilityType: 'STUDENT_TUTOR', verificationLevel: 'FULL' },
      services: [
        {
          title: '隐藏的数学课',
          priceMinor: 1_000,
          deliveryMode: 'ONLINE',
          codes: [MATH, GRADE_1],
        },
      ],
    });

    suspendedAccount = await newProvider({
      searchable: true,
      approvalStatus: 'APPROVED',
      cityCode: 'BEIJING',
      userStatus: 'SUSPENDED',
      rating: [5, 99],
      capability: { capabilityType: 'STUDENT_TUTOR', verificationLevel: 'FULL' },
      services: [
        { title: '停号数学课', priceMinor: 1_000, deliveryMode: 'ONLINE', codes: [MATH, GRADE_1] },
      ],
    });
  });

  afterAll(async () => {
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerCapability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T010_' } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface NewProviderOptions {
    searchable: boolean;
    approvalStatus: 'DRAFT' | 'APPROVED' | 'SUSPENDED';
    cityCode: string;
    userStatus: 'ACTIVE' | 'SUSPENDED';
    rating: [number, number];
    capability: { capabilityType: string; verificationLevel: 'NONE' | 'FULL' };
    services: {
      title: string;
      priceMinor: number;
      deliveryMode: 'ONLINE' | 'OFFLINE';
      codes: string[];
    }[];
  }

  async function newProvider(options: NewProviderOptions): Promise<string> {
    const user = await prisma.user.create({
      data: { displayName: '老师', status: options.userStatus },
    });
    userIds.push(user.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        providerType: 'TUTORING',
        publicName: '老师',
        cityCode: options.cityCode,
        serviceMode: 'ONLINE',
        approvalStatus: options.approvalStatus,
        searchable: options.searchable,
        ratingAvg: options.rating[0],
        ratingCount: options.rating[1],
        completedOrderCount: 3,
      },
    });
    providerIds.push(provider.id);

    await prisma.providerCapability.create({
      data: {
        providerId: provider.id,
        capabilityType: options.capability.capabilityType,
        status: 'APPROVED',
        verificationLevel: options.capability.verificationLevel,
        complianceStatus:
          options.capability.capabilityType === 'TEACHER' ? 'RESTRICTED' : 'NOT_REQUIRED',
      },
    });

    for (const service of options.services) {
      const created = await prisma.service.create({
        data: {
          providerId: provider.id,
          domain: 'TUTORING',
          title: service.title,
          durationMinutes: 60,
          priceMinor: service.priceMinor,
          currency: 'CNY',
          deliveryMode: service.deliveryMode,
          status: 'PUBLISHED',
        },
      });

      for (const code of service.codes) {
        const term = await prisma.taxonomyTerm.findFirst({
          where: { code },
          select: { id: true },
        });
        // `service_terms` is a pure join table: `(service_id, term_id)` is the key.
        await prisma.serviceTerm.create({
          data: { serviceId: created.id, termId: term!.id },
        });
      }
    }

    return provider.id;
  }

  const query = (overrides: Partial<ProviderSearchQuery> = {}): ProviderSearchQuery => ({
    domain: 'TUTORING',
    cityCode: null,
    capabilityType: null,
    subjectCode: null,
    gradeCode: null,
    deliveryMode: null,
    minPriceMinor: null,
    maxPriceMinor: null,
    verifiedOnly: false,
    page: 1,
    pageSize: 20,
    sort: 'relevance',
    ...overrides,
  });

  it('returns discoverable providers only', async () => {
    const page = await directory.search(query());

    const ids = page.hits.map((hit) => hit.provider.id);
    expect(ids).toContain(visible);
    expect(ids).toContain(other);
    // Approved but not searchable, and a suspended account, stay hidden.
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(suspendedAccount);
    expect(page.total).toBe(2);
  });

  it('filters by city, subject, grade, delivery mode and price', async () => {
    const beijing = await directory.search(query({ cityCode: 'BEIJING' }));
    expect(beijing.hits.map((hit) => hit.provider.id)).toEqual([visible]);

    const physics = await directory.search(query({ subjectCode: PHYSICS }));
    expect(physics.hits.map((hit) => hit.provider.id)).toEqual([other]);

    // The tag pair must be on the same service: math in grade 2 exists, math in
    // grade 1 too, but physics is never grade 1.
    const mathGrade1 = await directory.search(query({ subjectCode: MATH, gradeCode: GRADE_1 }));
    expect(mathGrade1.hits.map((hit) => hit.provider.id)).toEqual([visible]);

    const physicsGrade1 = await directory.search(
      query({ subjectCode: PHYSICS, gradeCode: GRADE_1 }),
    );
    expect(physicsGrade1.hits).toHaveLength(0);

    const offline = await directory.search(query({ deliveryMode: 'OFFLINE' }));
    expect(offline.hits.map((hit) => hit.provider.id)).toEqual([other]);

    const cheap = await directory.search(query({ maxPriceMinor: 10_000 }));
    expect(cheap.hits.map((hit) => hit.provider.id)).toEqual([visible]);

    const mid = await directory.search(query({ minPriceMinor: 30_000, maxPriceMinor: 60_000 }));
    expect(mid.hits.map((hit) => hit.provider.id)).toEqual([other]);
  });

  it('filters by capability type and by the verification gate', async () => {
    const teachers = await directory.search(query({ capabilityType: 'TEACHER' }));
    expect(teachers.hits.map((hit) => hit.provider.id)).toEqual([other]);

    const verified = await directory.search(query({ verifiedOnly: true }));
    expect(verified.hits.map((hit) => hit.provider.id)).toEqual([visible]);
  });

  it('reports the cheapest published service of each hit', async () => {
    const page = await directory.search(query({ cityCode: 'BEIJING' }));

    expect(page.hits[0]?.minPriceMinor).toBe(9_000);
  });

  it('pages deterministically and never repeats a row', async () => {
    const first = await directory.search(query({ pageSize: 1, page: 1 }));
    const second = await directory.search(query({ pageSize: 1, page: 2 }));

    expect(first.hits).toHaveLength(1);
    expect(second.hits).toHaveLength(1);
    expect(first.hits[0]?.provider.id).not.toBe(second.hits[0]?.provider.id);
    // `total` always counts every match, not just the page.
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);

    const empty = await directory.search(query({ page: 3, pageSize: 1 }));
    expect(empty.hits).toHaveLength(0);
  });

  it('orders by rating and by recency on request', async () => {
    const byRating = await directory.search(query({ sort: 'rating' }));
    expect(byRating.hits[0]?.provider.id).toBe(other);

    const byRecency = await directory.search(query({ sort: 'newest' }));
    expect(byRecency.hits[0]?.provider.id).toBe(other);
  });

  it('reads a discoverable provider with its published services only', async () => {
    const detail = await directory.findDiscoverable(visible);

    expect(detail?.provider.cityCode).toBe('BEIJING');
    expect(detail?.services).toHaveLength(2);
    expect(detail?.services.every((service) => service.status === 'PUBLISHED')).toBe(true);
    expect(detail?.capabilities[0]?.verificationLevel).toBe('FULL');
  });

  it('answers null for anything that is not discoverable', async () => {
    expect(await directory.findDiscoverable(hidden)).toBeNull();
    expect(await directory.findDiscoverable(suspendedAccount)).toBeNull();
    expect(await directory.findDiscoverable('22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(await directory.findDiscoverable('not-a-uuid')).toBeNull();
  });
});
