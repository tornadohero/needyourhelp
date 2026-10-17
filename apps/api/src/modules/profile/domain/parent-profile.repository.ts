import type { ParentProfile, UpsertParentProfileInput } from './parent-profile.model';

/** Dependency-injection token for {@link ParentProfileRepository}. */
export const PARENT_PROFILE_REPOSITORY = 'PARENT_PROFILE_REPOSITORY';

export interface ParentProfileRepository {
  findByUserId(userId: string): Promise<ParentProfile | null>;

  /** Create or update the account's single guardian profile. */
  upsert(input: UpsertParentProfileInput): Promise<ParentProfile>;
}
