/** Dependency-injection token for {@link ProviderReadinessGates}. */
export const PROVIDER_READINESS_GATES = 'PROVIDER_READINESS_GATES';

/**
 * Gates owned by other contexts.
 *
 * `specs/01-business-rules.md` §Provider approval requires an approved
 * verification and at least one published service before a provider is
 * discoverable, and both live in a different context: verification is T006 and
 * services are T009. The provider context therefore depends on these two ports
 * and never reads their tables itself.
 *
 * Until a context supplies a real adapter, its gate resolves to `false`: the
 * failure mode is "hidden", never "exposed".
 */
export interface ProviderReadinessGates {
  verificationSatisfied(providerId: string): Promise<boolean>;

  hasPublishedService(providerId: string): Promise<boolean>;
}

/** Dependency-injection token for {@link VerificationReadiness}. */
export const VERIFICATION_READINESS = 'VERIFICATION_READINESS';

/** Owned by the verification context (T006). */
export interface VerificationReadiness {
  isSatisfied(providerId: string): Promise<boolean>;
}

/** Dependency-injection token for {@link ServiceReadiness}. */
export const SERVICE_READINESS = 'SERVICE_READINESS';

/** Owned by the service context (T009). */
export interface ServiceReadiness {
  hasPublishedService(providerId: string): Promise<boolean>;
}
