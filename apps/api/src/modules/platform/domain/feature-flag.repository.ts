/** Dependency-injection token for {@link FeatureFlagRepository}. */
export const FEATURE_FLAG_REPOSITORY = 'FEATURE_FLAG_REPOSITORY';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
  updatedAt: Date;
}

/**
 * Persistence port for `feature_flags`.
 *
 * Flags gate whole marketplaces and capabilities: `career_marketplace_enabled`
 * is required before anything career-facing exists (`AGENTS.md` §7,
 * `specs/03-architecture-spec.md` §Feature flags).
 */
export interface FeatureFlagRepository {
  /** Unknown flags are disabled: the safe failure mode is "hidden". */
  isEnabled(key: string): Promise<boolean>;

  /** `GET /admin/feature-flags`. */
  list(): Promise<FeatureFlag[]>;

  /**
   * `PATCH /admin/feature-flags/:key`.
   *
   * Creating a flag is allowed: without it, turning a marketplace on would need
   * a database edit, which is exactly what T019 removes.
   */
  setEnabled(key: string, enabled: boolean): Promise<FeatureFlag>;
}
