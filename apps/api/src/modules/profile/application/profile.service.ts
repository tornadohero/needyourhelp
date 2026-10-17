import { Inject, Injectable } from '@nestjs/common';

import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import type { ParentProfile } from '../domain/parent-profile.model';
import { PARENT_PROFILE_REPOSITORY } from '../domain/parent-profile.repository';
import type { ParentProfileRepository } from '../domain/parent-profile.repository';
import { profileNotFound } from '../domain/profile.errors';

export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string | null;
  cityCode?: string | null;
  timezone?: string;
}

export interface OwnProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  parentProfile: ParentProfile | null;
}

/**
 * `GET|PUT /me/profile` (`specs/05-api-spec.md` §Profile).
 *
 * The subject always comes from the authenticated principal; the request body
 * can never select an account (`AGENTS.md` §7).
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PARENT_PROFILE_REPOSITORY) private readonly parents: ParentProfileRepository,
  ) {}

  async getProfile(userId: string): Promise<OwnProfile> {
    const [user, parentProfile] = await Promise.all([
      this.users.findById(userId),
      this.parents.findByUserId(userId),
    ]);

    if (!user) {
      throw profileNotFound('Account not found.');
    }

    return {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      parentProfile,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<OwnProfile> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw profileNotFound('Account not found.');
    }

    const hasAccountChange = input.displayName !== undefined || input.avatarUrl !== undefined;
    if (hasAccountChange) {
      await this.users.updateProfile(userId, {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      });
    }

    const hasGuardianChange = input.cityCode !== undefined || input.timezone !== undefined;
    if (hasGuardianChange) {
      const existing = await this.parents.findByUserId(userId);
      await this.parents.upsert({
        userId,
        // The guardian profile is created on first use; it mirrors the account
        // display name because no separate guardian name is collected in V1.
        displayName: input.displayName ?? existing?.displayName ?? user.displayName,
        cityCode: input.cityCode ?? existing?.cityCode ?? null,
        timezone: input.timezone ?? existing?.timezone ?? 'Asia/Shanghai',
      });
    }

    return this.getProfile(userId);
  }
}
