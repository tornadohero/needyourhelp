import type {
  ProviderDetail,
  ProviderSearchPage,
  ProviderSearchQuery,
} from './provider-search.model';

/** Dependency-injection token for {@link ProviderDirectory}. */
export const PROVIDER_DIRECTORY = 'PROVIDER_DIRECTORY';

/**
 * Read-only directory of discoverable providers.
 *
 * The acceptance criterion of T010 is enforced here, in one place: nothing in
 * the discovery context is allowed to read a provider that is not discoverable,
 * so a query can never widen into "everybody who applied".
 *
 * `specs/01-business-rules.md` §Provider approval: account active, application
 * approved, verification approved, compliance passed, at least one published
 * service, no blocking suspension.
 */
export interface ProviderDirectory {
  /** Filtered, paged and always bounded; `total` counts every match. */
  search(query: ProviderSearchQuery): Promise<ProviderSearchPage>;

  /** `null` for an unknown id and for a provider that is not discoverable. */
  findDiscoverable(providerId: string): Promise<ProviderDetail | null>;
}
