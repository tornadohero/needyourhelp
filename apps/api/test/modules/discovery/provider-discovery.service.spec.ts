import { beforeEach, describe, expect, it } from 'vitest';

import { FakeFeatureFlagRepository } from '../provider/fakes';
import { ProviderDiscoveryService } from '../../../src/modules/discovery/application/provider-discovery.service';
import {
  toProviderDetailResponse,
  toProviderSearchResponse,
  toPublicProviderResponse,
} from '../../../src/modules/discovery/http/discovery.mapper';
import { FakeProviderDirectory, capabilityFixture, profileFixture, serviceFixture } from './fakes';

function build(options: { careerEnabled?: boolean; detail?: unknown } = {}) {
  const directory = new FakeProviderDirectory({
    page: {
      hits: [
        {
          provider: profileFixture(),
          capabilities: [capabilityFixture()],
          minPriceMinor: 20_000,
        },
      ],
      total: 1,
    },
    detail: (options.detail as never) ?? null,
  });
  const flags = new FakeFeatureFlagRepository({
    career_marketplace_enabled: options.careerEnabled === true,
  });
  const service = new ProviderDiscoveryService(directory, flags);

  return { service, directory };
}

describe('ProviderDiscoveryService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('normalizes the query before it reaches the directory', async () => {
    const result = await context.service.search({
      city: 'beijing',
      subject: 'math',
      page: 2,
      pageSize: 5,
      verifiedOnly: true,
    });

    expect(context.directory.queries).toHaveLength(1);
    expect(context.directory.queries[0]).toMatchObject({
      cityCode: 'BEIJING',
      subjectCode: 'MATH',
      page: 2,
      pageSize: 5,
      verifiedOnly: true,
      domain: 'TUTORING',
    });
    expect(result.total).toBe(1);
  });

  it('maps only public fields, never the account or workflow state', async () => {
    const result = await context.service.search();
    const response = toProviderSearchResponse(result);

    expect(response.items[0]).toEqual({
      id: expect.any(String),
      providerType: 'TUTORING',
      publicName: '李老师',
      headline: '数学辅导',
      bio: '十年经验',
      avatarAssetId: null,
      cityCode: 'BEIJING',
      serviceMode: 'ONLINE',
      ratingAvg: 4.5,
      ratingCount: 12,
      completedOrderCount: 30,
      capabilities: [{ capabilityType: 'STUDENT_TUTOR', verificationLevel: 'FULL' }],
      createdAt: expect.any(String),
      minPriceMinor: 20_000,
    });
  });

  it('publishes a photo only when the provider made it public', () => {
    const privateProfile = toPublicProviderResponse(profileFixture(), []);
    const publicProfile = toPublicProviderResponse(
      profileFixture({ avatarVisibility: 'PUBLIC' }),
      [],
    );

    expect(privateProfile.avatarAssetId).toBeNull();
    expect(publicProfile.avatarAssetId).toBe('avatar-1');
  });

  it('hides the whole career marketplace while the flag is off', async () => {
    const career = await context.service.search({ domain: 'CAREER' });

    expect(career).toEqual({ hits: [], total: 0, page: 1, pageSize: 20 });
    // The directory is never even asked: a flagged-off domain has no listing.
    expect(context.directory.queries).toHaveLength(0);
  });

  it('searches the career marketplace once the flag is on', async () => {
    context = build({ careerEnabled: true });

    await context.service.search({ domain: 'CAREER' });

    expect(context.directory.queries[0]?.domain).toBe('CAREER');
  });

  it('answers NOT_FOUND for anything that is not discoverable', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000009', 'not-a-uuid']) {
      await expect(context.service.getDetail(id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      await expect(context.service.listServices(id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    // Only the well-formed id is looked up: a malformed one never reaches the
    // database.
    expect(new Set(context.directory.lookedUp)).toEqual(
      new Set(['00000000-0000-4000-8000-000000000009']),
    );
  });

  it('returns a discoverable provider with its published services', async () => {
    const published = serviceFixture({ status: 'PUBLISHED' });
    const draft = serviceFixture({ id: '00000000-0000-4000-8000-0000000000bb', status: 'DRAFT' });
    context = build({
      detail: {
        provider: profileFixture(),
        capabilities: [capabilityFixture()],
        // The directory only ever returns published services.
        services: [published, draft],
      } as never,
    });

    const detail = await context.service.getDetail('00000000-0000-4000-8000-000000000001');
    const response = toProviderDetailResponse(detail);

    expect(response.services).toHaveLength(2);
    expect(response.services.map((service) => service.title)).toEqual(['数学一对一', '数学一对一']);
    expect(Object.keys(response)).not.toContain('userId');
    expect(Object.keys(response)).not.toContain('approvalStatus');
  });

  it('hides a career provider detail while the flag is off', async () => {
    context = build({
      detail: {
        provider: profileFixture({ providerType: 'CAREER' }),
        capabilities: [],
        services: [],
      } as never,
    });

    await expect(
      context.service.getDetail('00000000-0000-4000-8000-000000000001'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    context = build({
      careerEnabled: true,
      detail: {
        provider: profileFixture({ providerType: 'CAREER' }),
        capabilities: [],
        services: [],
      } as never,
    });
    await expect(
      context.service.getDetail('00000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({ provider: { providerType: 'CAREER' } });
  });
});
