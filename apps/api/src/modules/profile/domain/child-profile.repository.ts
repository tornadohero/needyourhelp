import type {
  ChildConsentStatus,
  ChildProfile,
  CreateChildProfileInput,
  UpdateChildProfileInput,
} from './child-profile.model';

/** Dependency-injection token for {@link ChildProfileRepository}. */
export const CHILD_PROFILE_REPOSITORY = 'CHILD_PROFILE_REPOSITORY';

export interface ChildProfileRepository {
  create(input: CreateChildProfileInput): Promise<ChildProfile>;

  /** Returns the row even when soft-deleted; the service decides visibility. */
  findById(id: string): Promise<ChildProfile | null>;

  /** Non-deleted children of one guardian (`child_profiles(guardian_user_id, deleted_at)`). */
  listByGuardian(guardianUserId: string): Promise<ChildProfile[]>;

  update(id: string, input: UpdateChildProfileInput): Promise<ChildProfile>;

  /** Soft delete: history (orders) keeps referencing the row. */
  softDelete(id: string): Promise<void>;

  /**
   * Mirror the guardian's consent state onto every live child profile.
   *
   * `child_profiles.data_processing_consent_status` is derived state: the source
   * of truth is the consent record (`specs/10-privacy-and-minors.md`).
   */
  setConsentStatusForGuardian(guardianUserId: string, status: ChildConsentStatus): Promise<number>;
}
