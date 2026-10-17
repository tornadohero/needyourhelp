import type {
  Consent,
  ConsentType,
  GrantConsentInput,
} from '../../../src/modules/identity/domain/consent.model';
import type { ConsentRepository } from '../../../src/modules/identity/domain/consent.repository';
import type {
  CreateUserInput,
  UpdateUserProfileInput,
  User,
  UserStatus,
} from '../../../src/modules/identity/domain/user.model';
import type { UserRepository } from '../../../src/modules/identity/domain/user.repository';
import type { Role } from '../../../src/modules/identity/domain/user.model';
import type {
  ChildConsentStatus,
  ChildProfile,
  CreateChildProfileInput,
  UpdateChildProfileInput,
} from '../../../src/modules/profile/domain/child-profile.model';
import type { ChildProfileRepository } from '../../../src/modules/profile/domain/child-profile.repository';
import type {
  ParentProfile,
  UpsertParentProfileInput,
} from '../../../src/modules/profile/domain/parent-profile.model';
import type { ParentProfileRepository } from '../../../src/modules/profile/domain/parent-profile.repository';

let sequence = 0;

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** In-memory {@link UserRepository}. */
export class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByWechatOpenidHash(openidHash: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.wechatOpenidHash === openidHash) {
        return user;
      }
    }
    return null;
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.createWithRoles(input, []);
  }

  async createWithRoles(input: CreateUserInput, _roles: Role[]): Promise<User> {
    const now = new Date();
    const user: User = {
      id: nextId('user'),
      status: 'ACTIVE',
      wechatOpenidHash: input.wechatOpenidHash ?? null,
      unionidHash: input.unionidHash ?? null,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('user not found');
    }
    const updated: User = {
      ...user,
      displayName: input.displayName ?? user.displayName,
      avatarUrl: input.avatarUrl === undefined ? user.avatarUrl : input.avatarUrl,
    };
    this.users.set(userId, updated);
    return updated;
  }

  /**
   * No-op: role assignment is out of scope for the profile tests. Subclasses
   * (e.g. the provider test fake) override it to observe role changes.
   */
  async addRole(_userId: string, _role: Role): Promise<void> {}

  async removeRole(_userId: string, _role: Role): Promise<void> {}

  async listRoles(_userId: string): Promise<Role[]> {
    return [];
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      this.users.set(userId, { ...user, status });
    }
  }
}

/** In-memory {@link ConsentRepository} (append-only). */
export class FakeConsentRepository implements ConsentRepository {
  readonly consents: Consent[] = [];

  async findActive(userId: string, consentType: ConsentType): Promise<Consent | null> {
    const active = this.consents.filter(
      (consent) =>
        consent.userId === userId &&
        consent.consentType === consentType &&
        consent.granted &&
        consent.revokedAt === null,
    );
    return active.length > 0 ? (active[active.length - 1] ?? null) : null;
  }

  async listByUser(userId: string): Promise<Consent[]> {
    return [...this.consents.filter((consent) => consent.userId === userId)].reverse();
  }

  async grant(input: GrantConsentInput): Promise<Consent> {
    const consent: Consent = {
      id: nextId('consent'),
      userId: input.userId,
      consentType: input.consentType,
      policyVersion: input.policyVersion,
      granted: true,
      grantedAt: new Date(),
      revokedAt: null,
      evidenceRef: input.evidenceRef ?? null,
    };
    this.consents.push(consent);
    return consent;
  }

  async revokeActive(userId: string, consentType: ConsentType): Promise<Consent | null> {
    const active = await this.findActive(userId, consentType);
    if (!active) {
      return null;
    }
    active.revokedAt = new Date();
    return active;
  }
}

/** In-memory {@link ParentProfileRepository} (1:1 with the account). */
export class FakeParentProfileRepository implements ParentProfileRepository {
  readonly profiles = new Map<string, ParentProfile>();

  async findByUserId(userId: string): Promise<ParentProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsert(input: UpsertParentProfileInput): Promise<ParentProfile> {
    const existing = this.profiles.get(input.userId);
    const profile: ParentProfile = {
      id: existing?.id ?? nextId('parent'),
      userId: input.userId,
      displayName: input.displayName,
      cityCode: input.cityCode ?? null,
      timezone: input.timezone ?? 'Asia/Shanghai',
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.profiles.set(input.userId, profile);
    return profile;
  }
}

/** In-memory {@link ChildProfileRepository}. */
export class FakeChildProfileRepository implements ChildProfileRepository {
  readonly children = new Map<string, ChildProfile>();

  async create(input: CreateChildProfileInput): Promise<ChildProfile> {
    const now = new Date();
    const child: ChildProfile = {
      id: nextId('child'),
      guardianUserId: input.guardianUserId,
      nickname: input.nickname,
      birthYear: input.birthYear ?? null,
      gradeCode: input.gradeCode ?? null,
      schoolName: input.schoolName ?? null,
      learningGoals: input.learningGoals ?? null,
      dataProcessingConsentStatus: input.dataProcessingConsentStatus,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.children.set(child.id, child);
    return child;
  }

  async findById(id: string): Promise<ChildProfile | null> {
    return this.children.get(id) ?? null;
  }

  async listByGuardian(guardianUserId: string): Promise<ChildProfile[]> {
    return [...this.children.values()].filter(
      (child) => child.guardianUserId === guardianUserId && child.deletedAt === null,
    );
  }

  async update(id: string, input: UpdateChildProfileInput): Promise<ChildProfile> {
    const child = this.children.get(id);
    if (!child) {
      throw new Error('child not found');
    }
    const updated: ChildProfile = { ...child, ...input, updatedAt: new Date() };
    this.children.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    const child = this.children.get(id);
    if (child) {
      this.children.set(id, { ...child, deletedAt: new Date() });
    }
  }

  async setConsentStatusForGuardian(
    guardianUserId: string,
    status: ChildConsentStatus,
  ): Promise<number> {
    let count = 0;
    for (const child of this.children.values()) {
      if (child.guardianUserId === guardianUserId && child.deletedAt === null) {
        this.children.set(child.id, { ...child, dataProcessingConsentStatus: status });
        count += 1;
      }
    }
    return count;
  }
}
