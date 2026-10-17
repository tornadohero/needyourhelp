import type {
  ProviderDetail,
  ProviderSearchPage,
  ProviderSearchQuery,
} from '../../../src/modules/discovery/domain/provider-search.model';
import type { ProviderDirectory } from '../../../src/modules/discovery/domain/provider-directory';
import type {
  ProviderCapability,
  ProviderProfile,
} from '../../../src/modules/provider/domain/provider-profile.model';
import type { Service } from '../../../src/modules/services/domain/service.model';

/** In-memory {@link ProviderDirectory}: records the query it was asked for. */
export class FakeProviderDirectory implements ProviderDirectory {
  readonly queries: ProviderSearchQuery[] = [];
  readonly lookedUp: string[] = [];

  constructor(
    private readonly state: {
      page?: ProviderSearchPage;
      detail?: ProviderDetail | null;
    } = {},
  ) {}

  async search(query: ProviderSearchQuery): Promise<ProviderSearchPage> {
    this.queries.push(query);
    return this.state.page ?? { hits: [], total: 0 };
  }

  async findDiscoverable(providerId: string): Promise<ProviderDetail | null> {
    this.lookedUp.push(providerId);
    return this.state.detail ?? null;
  }
}

export function profileFixture(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: '数学辅导',
    bio: '十年经验',
    avatarVisibility: 'PRIVATE',
    avatarAssetId: 'avatar-1',
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    approvalStatus: 'APPROVED',
    searchable: true,
    ratingAvg: 4.5,
    ratingCount: 12,
    completedOrderCount: 30,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

export function capabilityFixture(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
  return {
    id: '00000000-0000-4000-8000-0000000000ff',
    providerId: '00000000-0000-4000-8000-000000000001',
    capabilityType: 'STUDENT_TUTOR',
    status: 'APPROVED',
    verificationLevel: 'FULL',
    // Internal: a restricted teacher scope must never reach a public payload.
    complianceStatus: 'RESTRICTED',
    restrictionJson: { allowedSubjectCodes: ['MATH'] },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function serviceFixture(overrides: Partial<Service> = {}): Service {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    providerId: '00000000-0000-4000-8000-000000000001',
    domain: 'TUTORING',
    title: '数学一对一',
    description: null,
    durationMinutes: 60,
    priceMinor: 20_000,
    currency: 'CNY',
    deliveryMode: 'ONLINE',
    status: 'PUBLISHED',
    terms: [{ termId: 'term-1', type: 'SUBJECT', code: 'MATH', name: '数学' }],
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  };
}
