import { beforeEach, describe, expect, it } from 'vitest';

import { FakeTaxonomyRepository } from '../catalog/fakes';
import {
  FakeFeatureFlagRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  TrackingUserRepository,
} from '../provider/fakes';
import { ProviderApplicationService } from '../../../src/modules/provider/application/provider-application.service';
import type { ProviderType } from '../../../src/modules/provider/domain/provider-profile.model';
import { ProviderServiceService } from '../../../src/modules/services/application/provider-service.service';
import { FakeServiceRepository, ServiceAwareReadinessGates } from './fakes';

interface BuildOptions {
  careerEnabled?: boolean;
  verificationSatisfied?: boolean;
}

function build(options: BuildOptions = {}) {
  const taxonomy = new FakeTaxonomyRepository();
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const flags = new FakeFeatureFlagRepository({
    career_marketplace_enabled: options.careerEnabled === true,
  });
  const users = new TrackingUserRepository();
  const services = new FakeServiceRepository(taxonomy);
  const gates = new ServiceAwareReadinessGates(services, options.verificationSatisfied === true);
  const applications = new ProviderApplicationService(profiles, capabilities, flags, gates, users);
  const service = new ProviderServiceService(services, taxonomy, applications);

  return { taxonomy, profiles, services, applications, service, users };
}

type Context = ReturnType<typeof build>;

async function seedTerms(ctx: Context): Promise<void> {
  await ctx.taxonomy.create({ type: 'SUBJECT', code: 'MATH', name: '数学' });
  await ctx.taxonomy.create({ type: 'SUBJECT', code: 'PHYSICS', name: '物理' });
  await ctx.taxonomy.create({ type: 'GRADE', code: 'PRIMARY_1', name: '小学一年级' });
  await ctx.taxonomy.create({ type: 'SKILL', code: 'HOMEWORK_SUPPORT', name: '作业辅导' });
  // Career expertise (`specs/00-product-spec.md` §Career Mentor: publish expertise).
  await ctx.taxonomy.create({ type: 'SKILL', code: 'RESUME_REVIEW', name: '简历诊断' });
  await ctx.taxonomy.create({ type: 'CITY', code: 'BEIJING', name: '北京' });
}

async function newProvider(
  ctx: Context,
  options: { approved?: boolean; providerType?: ProviderType } = {},
): Promise<{ userId: string; providerId: string }> {
  const providerType = options.providerType ?? 'TUTORING';
  const user = await ctx.users.create({ displayName: '老师' });
  const application = await ctx.applications.createApplication(user.id, {
    providerType,
    publicName: '李老师',
    capabilityTypes: [providerType === 'CAREER' ? 'CAREER_MENTOR' : 'STUDENT_TUTOR'],
  });

  const profile =
    options.approved === true
      ? await ctx.profiles.setApprovalStatus(application.profile.id, 'APPROVED')
      : application.profile;

  return { userId: user.id, providerId: profile.id };
}

const BASE_SERVICE = {
  title: '数学一对一',
  durationMinutes: 60,
  priceMinor: 20_000,
  subjectCodes: ['MATH'],
} as const;

describe('ProviderServiceService', () => {
  let ctx: Context;

  beforeEach(async () => {
    ctx = build({ verificationSatisfied: true });
    await seedTerms(ctx);
  });

  it('creates a draft service with resolved, normalized tags', async () => {
    const { userId, providerId } = await newProvider(ctx);

    const service = await ctx.service.create(userId, 'TUTORING', {
      ...BASE_SERVICE,
      // Lower case on the wire, upper case in the catalogue.
      subjectCodes: ['math'],
      gradeCodes: ['primary_1'],
      skillCodes: ['HOMEWORK_SUPPORT'],
      cityCodes: ['BEIJING'],
    });

    expect(service.status).toBe('DRAFT');
    expect(service.providerId).toBe(providerId);
    expect(service.domain).toBe('TUTORING');
    expect(service.currency).toBe('CNY');
    expect(service.deliveryMode).toBe('ONLINE');
    expect(service.terms.map((term) => `${term.type}:${term.code}`).sort()).toEqual([
      'CITY:BEIJING',
      'GRADE:PRIMARY_1',
      'SKILL:HOMEWORK_SUPPORT',
      'SUBJECT:MATH',
    ]);
  });

  it('validates price and duration server-side', async () => {
    const { userId } = await newProvider(ctx);

    for (const invalid of [
      { priceMinor: 0 },
      { priceMinor: 99 },
      { priceMinor: 20_000.5 },
      { priceMinor: 1_000_001 },
      { durationMinutes: 0 },
      { durationMinutes: 10 },
      { durationMinutes: 481 },
      { durationMinutes: 45.5 },
    ]) {
      await expect(
        ctx.service.create(userId, 'TUTORING', { ...BASE_SERVICE, ...invalid }),
        JSON.stringify(invalid),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
  });

  it('validates the title, currency and description', async () => {
    const { userId } = await newProvider(ctx);

    await expect(
      ctx.service.create(userId, 'TUTORING', { ...BASE_SERVICE, title: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create(userId, 'TUTORING', { ...BASE_SERVICE, currency: 'CN' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create(userId, 'TUTORING', {
        ...BASE_SERVICE,
        description: '课'.repeat(2001),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const ok = await ctx.service.create(userId, 'TUTORING', {
      ...BASE_SERVICE,
      currency: 'cny',
      description: '   ',
    });
    expect(ok.currency).toBe('CNY');
    expect(ok.description).toBeNull();
  });

  it('refuses unknown and archived taxonomy codes', async () => {
    const { userId } = await newProvider(ctx);

    await expect(
      ctx.service.create(userId, 'TUTORING', { ...BASE_SERVICE, subjectCodes: ['LATIN'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await ctx.taxonomy.create({ type: 'SUBJECT', code: 'HISTORY', name: '历史' });
    const history = await ctx.taxonomy.findByCode('SUBJECT', 'HISTORY');
    await ctx.taxonomy.setActive(history!.id, false);

    await expect(
      ctx.service.create(userId, 'TUTORING', { ...BASE_SERVICE, subjectCodes: ['HISTORY'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('requires a subject for a tutoring service', async () => {
    const { userId } = await newProvider(ctx);

    await expect(
      ctx.service.create(userId, 'TUTORING', {
        ...BASE_SERVICE,
        subjectCodes: undefined,
        gradeCodes: ['PRIMARY_1'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('follows the provider domain and publishes expertise, not a subject', async () => {
    ctx = build({ careerEnabled: true });
    await seedTerms(ctx);
    const { userId } = await newProvider(ctx, { providerType: 'CAREER' });

    const service = await ctx.service.create(userId, 'CAREER', {
      title: '简历诊断',
      durationMinutes: 45,
      priceMinor: 30_000,
      skillCodes: ['RESUME_REVIEW'],
      cityCodes: ['BEIJING'],
    });

    expect(service.domain).toBe('CAREER');
    expect(service.terms.map((term) => term.code).sort()).toEqual(['BEIJING', 'RESUME_REVIEW']);

    // Expertise is what is published: a career offer with no skill is refused.
    await expect(
      ctx.service.create(userId, 'CAREER', {
        title: '无标签咨询',
        durationMinutes: 45,
        priceMinor: 30_000,
        cityCodes: ['BEIJING'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses to create a service without a provider application', async () => {
    const user = await ctx.users.create({ displayName: '路人' });

    await expect(ctx.service.create(user.id, 'TUTORING', BASE_SERVICE)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('lists only the services of the caller', async () => {
    const first = await newProvider(ctx);
    const second = await newProvider(ctx);

    await ctx.service.create(first.userId, 'TUTORING', BASE_SERVICE);
    await ctx.service.create(second.userId, 'TUTORING', {
      ...BASE_SERVICE,
      title: '物理一对一',
      subjectCodes: ['PHYSICS'],
    });

    const mine = await ctx.service.listMine(first.userId, 'TUTORING');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe('数学一对一');
  });

  it('edits a draft and keeps the tags of the types that are not supplied', async () => {
    const { userId } = await newProvider(ctx);
    const created = await ctx.service.create(userId, 'TUTORING', {
      ...BASE_SERVICE,
      gradeCodes: ['PRIMARY_1'],
      cityCodes: ['BEIJING'],
    });

    const updated = await ctx.service.update(userId, 'TUTORING', created.id, {
      priceMinor: 25_000,
      subjectCodes: ['PHYSICS'],
    });

    expect(updated.priceMinor).toBe(25_000);
    expect(updated.terms.map((term) => `${term.type}:${term.code}`).sort()).toEqual([
      'CITY:BEIJING',
      'GRADE:PRIMARY_1',
      'SUBJECT:PHYSICS',
    ]);

    const cleared = await ctx.service.update(userId, 'TUTORING', created.id, {
      description: null,
    });
    expect(cleared.description).toBeNull();
  });

  it('cannot edit a published service', async () => {
    const { userId } = await newProvider(ctx, { approved: true });
    const created = await ctx.service.create(userId, 'TUTORING', BASE_SERVICE);
    await ctx.service.publish(userId, 'TUTORING', created.id);

    await expect(
      ctx.service.update(userId, 'TUTORING', created.id, { priceMinor: 1_000 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Unpublish -> edit -> publish is the supported path.
    await ctx.service.unpublish(userId, 'TUTORING', created.id);
    const edited = await ctx.service.update(userId, 'TUTORING', created.id, {
      priceMinor: 22_000,
    });
    expect(edited.priceMinor).toBe(22_000);
  });

  it('refuses to publish before the provider is approved', async () => {
    const { userId } = await newProvider(ctx, { approved: false });
    const created = await ctx.service.create(userId, 'TUTORING', BASE_SERVICE);

    await expect(ctx.service.publish(userId, 'TUTORING', created.id)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
      status: 409,
    });
  });

  it('publishes only through the state machine', async () => {
    const { userId, providerId } = await newProvider(ctx, { approved: true });
    const created = await ctx.service.create(userId, 'TUTORING', BASE_SERVICE);

    const published = await ctx.service.publish(userId, 'TUTORING', created.id);
    expect(published.status).toBe('PUBLISHED');

    // Publishing twice is not a transition.
    await expect(ctx.service.publish(userId, 'TUTORING', created.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const profile = await ctx.profiles.findById(providerId);
    expect(profile?.searchable).toBe(true);
  });

  it('unpublishes and takes the provider out of discovery again', async () => {
    const { userId, providerId } = await newProvider(ctx, { approved: true });
    const created = await ctx.service.create(userId, 'TUTORING', BASE_SERVICE);
    await ctx.service.publish(userId, 'TUTORING', created.id);

    const unpublished = await ctx.service.unpublish(userId, 'TUTORING', created.id);
    expect(unpublished.status).toBe('UNPUBLISHED');

    await expect(ctx.service.unpublish(userId, 'TUTORING', created.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const profile = await ctx.profiles.findById(providerId);
    expect(profile?.searchable).toBe(false);
  });

  it('keeps a provider hidden while verification is still missing', async () => {
    ctx = build({ verificationSatisfied: false });
    await seedTerms(ctx);
    const { userId, providerId } = await newProvider(ctx, { approved: true });
    const created = await ctx.service.create(userId, 'TUTORING', BASE_SERVICE);

    await ctx.service.publish(userId, 'TUTORING', created.id);

    // Published, but the verification gate (T006) is still closed.
    const profile = await ctx.profiles.findById(providerId);
    expect(profile?.searchable).toBe(false);
  });

  it('refuses another provider service and unknown ids', async () => {
    const owner = await newProvider(ctx);
    const other = await newProvider(ctx);
    const created = await ctx.service.create(owner.userId, 'TUTORING', BASE_SERVICE);

    await expect(
      ctx.service.update(other.userId, 'TUTORING', created.id, { title: '抢' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(ctx.service.publish(other.userId, 'TUTORING', created.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    for (const id of ['22222222-2222-4222-8222-222222222222', 'not-a-uuid']) {
      await expect(
        ctx.service.update(owner.userId, 'TUTORING', id, { title: 'x' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(ctx.service.publish(owner.userId, 'TUTORING', id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(ctx.service.unpublish(owner.userId, 'TUTORING', id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('exposes the order facts for a published service only', async () => {
    const { userId } = await newProvider(ctx, { approved: true });
    const created = await ctx.service.create(userId, 'TUTORING', {
      ...BASE_SERVICE,
      cityCodes: ['BEIJING'],
    });

    await expect(ctx.service.assertOrderable(created.id)).rejects.toMatchObject({
      code: 'SERVICE_NOT_PUBLISHED',
      status: 409,
    });

    await ctx.service.publish(userId, 'TUTORING', created.id);

    const facts = await ctx.service.assertOrderable(created.id);
    expect(facts).toMatchObject({
      id: created.id,
      priceMinor: 20_000,
      currency: 'CNY',
      durationMinutes: 60,
      status: 'PUBLISHED',
      subjectCodes: ['MATH'],
      cityCode: 'BEIJING',
    });

    await expect(
      ctx.service.assertOrderable('22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
