import type {
  ApprovalStatus,
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderType,
  UpdateProviderProfileInput,
} from './provider-profile.model';

/** Dependency-injection token for {@link ProviderProfileRepository}. */
export const PROVIDER_PROFILE_REPOSITORY = 'PROVIDER_PROVIDER_PROFILE_REPOSITORY';

export interface ProviderProfileRepository {
  create(input: CreateProviderProfileInput): Promise<ProviderProfile>;

  findById(id: string): Promise<ProviderProfile | null>;

  /** `users 1---N provider_profiles`: one application per account and type. */
  findByUserAndType(userId: string, providerType: ProviderType): Promise<ProviderProfile | null>;

  listByUser(userId: string): Promise<ProviderProfile[]>;

  /** Batch read for admin listings, so a queue never queries per row. */
  findManyByIds(ids: string[]): Promise<ProviderProfile[]>;

  update(id: string, input: UpdateProviderProfileInput): Promise<ProviderProfile>;

  setApprovalStatus(id: string, status: ApprovalStatus): Promise<ProviderProfile>;

  /** Only ever called with a value computed from the readiness gates. */
  setSearchable(id: string, searchable: boolean): Promise<ProviderProfile>;

  /**
   * Rolling rating of the provider, written by the review context (T017).
   *
   * The average is computed from the reviews themselves, never from the client.
   */
  updateRating(id: string, ratingAvg: number, ratingCount: number): Promise<ProviderProfile>;

  /** Counted when an order reaches `COMPLETED` (`specs/01` §Ranking). */
  incrementCompletedOrderCount(id: string): Promise<ProviderProfile>;
}
