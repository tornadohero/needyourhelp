import type { Role } from '../../../src/modules/identity/domain/user.model';
import type {
  AuditLogRepository,
  RecordAuditLogInput,
} from '../../../src/modules/audit/domain/audit-log.repository';
import type {
  FeatureFlag,
  FeatureFlagRepository,
} from '../../../src/modules/platform/domain/feature-flag.repository';
import type {
  CapabilityType,
  ComplianceStatus,
  ProviderCapability,
  ProviderProfile,
  ProviderType,
} from '../../../src/modules/provider/domain/provider-profile.model';
import type { ProviderCapabilityRepository } from '../../../src/modules/provider/domain/provider-capability.repository';
import type { ProviderProfileRepository } from '../../../src/modules/provider/domain/provider-profile.repository';
import type { ProviderReadinessGates } from '../../../src/modules/provider/domain/provider-readiness.gates';
import type {
  CreateCapabilityInput,
  UpdateCapabilityInput,
} from '../../../src/modules/provider/domain/provider-profile.model';
import { FakeUserRepository } from '../profile/fakes';

let sequence = 0;

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** In-memory {@link ProviderProfileRepository}. */
export class FakeProviderProfileRepository implements ProviderProfileRepository {
  readonly profiles = new Map<string, ProviderProfile>();

  async create(input: {
    userId: string;
    providerType: ProviderType;
    publicName: string;
    headline?: string | null;
    bio?: string | null;
    avatarVisibility?: ProviderProfile['avatarVisibility'];
    cityCode?: string | null;
    serviceMode?: ProviderProfile['serviceMode'];
  }): Promise<ProviderProfile> {
    const now = new Date();
    const profile: ProviderProfile = {
      id: nextId('provider'),
      userId: input.userId,
      providerType: input.providerType,
      publicName: input.publicName,
      headline: input.headline ?? null,
      bio: input.bio ?? null,
      avatarVisibility: input.avatarVisibility ?? 'PRIVATE',
      avatarAssetId: null,
      cityCode: input.cityCode ?? null,
      serviceMode: input.serviceMode ?? 'ONLINE',
      approvalStatus: 'DRAFT',
      searchable: false,
      ratingAvg: null,
      ratingCount: 0,
      completedOrderCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async findById(id: string): Promise<ProviderProfile | null> {
    return this.profiles.get(id) ?? null;
  }

  async findByUserAndType(
    userId: string,
    providerType: ProviderType,
  ): Promise<ProviderProfile | null> {
    for (const profile of this.profiles.values()) {
      if (profile.userId === userId && profile.providerType === providerType) {
        return profile;
      }
    }
    return null;
  }

  async listByUser(userId: string): Promise<ProviderProfile[]> {
    return [...this.profiles.values()].filter((profile) => profile.userId === userId);
  }

  async findManyByIds(ids: string[]): Promise<ProviderProfile[]> {
    return ids
      .map((id) => this.profiles.get(id))
      .filter((profile): profile is ProviderProfile => profile !== undefined);
  }

  async update(
    id: string,
    input: {
      publicName?: string;
      headline?: string | null;
      bio?: string | null;
      avatarVisibility?: ProviderProfile['avatarVisibility'];
      cityCode?: string | null;
      serviceMode?: ProviderProfile['serviceMode'];
    },
  ): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('provider not found');
    }
    const updated: ProviderProfile = { ...profile, ...input, updatedAt: new Date() };
    this.profiles.set(id, updated);
    return updated;
  }

  async setApprovalStatus(
    id: string,
    status: ProviderProfile['approvalStatus'],
  ): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('provider not found');
    }
    const updated: ProviderProfile = { ...profile, approvalStatus: status, updatedAt: new Date() };
    this.profiles.set(id, updated);
    return updated;
  }

  async setSearchable(id: string, searchable: boolean): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('provider not found');
    }
    const updated: ProviderProfile = { ...profile, searchable, updatedAt: new Date() };
    this.profiles.set(id, updated);
    return updated;
  }

  async updateRating(id: string, ratingAvg: number, ratingCount: number): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('provider not found');
    }
    const updated: ProviderProfile = {
      ...profile,
      ratingAvg,
      ratingCount,
      updatedAt: new Date(),
    };
    this.profiles.set(id, updated);
    return updated;
  }

  async incrementCompletedOrderCount(id: string): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('provider not found');
    }
    const updated: ProviderProfile = {
      ...profile,
      completedOrderCount: profile.completedOrderCount + 1,
      updatedAt: new Date(),
    };
    this.profiles.set(id, updated);
    return updated;
  }
}

/** In-memory {@link ProviderCapabilityRepository}. */
export class FakeProviderCapabilityRepository implements ProviderCapabilityRepository {
  readonly capabilities = new Map<string, ProviderCapability>();

  async createMany(inputs: CreateCapabilityInput[]): Promise<ProviderCapability[]> {
    const created = inputs.map((input) => this.insert(input));
    return created;
  }

  async listByProvider(providerId: string): Promise<ProviderCapability[]> {
    return [...this.capabilities.values()].filter(
      (capability) => capability.providerId === providerId,
    );
  }

  async findById(id: string): Promise<ProviderCapability | null> {
    return this.capabilities.get(id) ?? null;
  }

  async listByComplianceStatus(filter: {
    statuses: ComplianceStatus[];
    capabilityType?: CapabilityType;
    limit: number;
  }): Promise<ProviderCapability[]> {
    return [...this.capabilities.values()]
      .filter(
        (capability) =>
          filter.statuses.includes(capability.complianceStatus) &&
          (filter.capabilityType === undefined ||
            capability.capabilityType === filter.capabilityType),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, filter.limit);
  }

  async findByProviderAndType(
    providerId: string,
    capabilityType: CapabilityType,
  ): Promise<ProviderCapability | null> {
    return (
      [...this.capabilities.values()].find(
        (capability) =>
          capability.providerId === providerId && capability.capabilityType === capabilityType,
      ) ?? null
    );
  }

  async replaceForProvider(
    providerId: string,
    inputs: CreateCapabilityInput[],
  ): Promise<ProviderCapability[]> {
    for (const [id, capability] of this.capabilities) {
      if (capability.providerId === providerId) {
        this.capabilities.delete(id);
      }
    }
    return inputs.map((input) => this.insert(input));
  }

  async update(id: string, input: UpdateCapabilityInput): Promise<ProviderCapability> {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new Error('capability not found');
    }
    const updated: ProviderCapability = { ...capability, ...input, updatedAt: new Date() };
    this.capabilities.set(id, updated);
    return updated;
  }

  private insert(input: CreateCapabilityInput): ProviderCapability {
    const now = new Date();
    const capability: ProviderCapability = {
      id: nextId('capability'),
      providerId: input.providerId,
      capabilityType: input.capabilityType,
      status: input.status ?? 'DRAFT',
      verificationLevel: input.verificationLevel ?? 'NONE',
      complianceStatus: input.complianceStatus ?? ('NOT_REQUIRED' as ComplianceStatus),
      restrictionJson: input.restrictionJson ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.capabilities.set(capability.id, capability);
    return capability;
  }
}

/** In-memory {@link FeatureFlagRepository}; unknown flags are disabled. */
export class FakeFeatureFlagRepository implements FeatureFlagRepository {
  readonly flags: Record<string, boolean>;

  constructor(flags: Record<string, boolean> = {}) {
    this.flags = { ...flags };
  }

  async isEnabled(key: string): Promise<boolean> {
    return this.flags[key] === true;
  }

  async list(): Promise<FeatureFlag[]> {
    return Object.entries(this.flags).map(([key, enabled]) => ({
      key,
      enabled,
      configJson: {},
      updatedAt: new Date(),
    }));
  }

  async setEnabled(key: string, enabled: boolean): Promise<FeatureFlag> {
    this.flags[key] = enabled;
    return { key, enabled, configJson: {}, updatedAt: new Date() };
  }
}

/** In-memory {@link ProviderReadinessGates} for tests. */
export class FakeProviderReadinessGates implements ProviderReadinessGates {
  constructor(
    private readonly state: {
      verificationSatisfied?: boolean;
      hasPublishedService?: boolean;
    } = {},
  ) {}

  async verificationSatisfied(): Promise<boolean> {
    return this.state.verificationSatisfied === true;
  }

  async hasPublishedService(): Promise<boolean> {
    return this.state.hasPublishedService === true;
  }
}

/** In-memory {@link AuditLogRepository}: records every row for assertions. */
export class FakeAuditLogRepository implements AuditLogRepository {
  readonly rows: RecordAuditLogInput[] = [];

  async record(input: RecordAuditLogInput): Promise<void> {
    this.rows.push(input);
  }

  find(action: string): RecordAuditLogInput | undefined {
    return this.rows.find((row) => row.action === action);
  }
}

/**
 * User fake that tracks roles.
 *
 * The shared profile fake treats roles as out of scope; provider approval grants
 * the `PROVIDER` role, so the role set must be observable.
 */
export class TrackingUserRepository extends FakeUserRepository {
  private readonly roles = new Map<string, Role[]>();

  override async addRole(userId: string, role: Role): Promise<void> {
    const current = this.roles.get(userId) ?? [];
    if (!current.includes(role)) {
      this.roles.set(userId, [...current, role]);
    }
  }

  override async listRoles(userId: string): Promise<Role[]> {
    return this.roles.get(userId) ?? [];
  }
}
