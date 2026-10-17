import type {
  CapabilityType,
  ComplianceStatus,
  CreateCapabilityInput,
  ProviderCapability,
  UpdateCapabilityInput,
} from './provider-profile.model';

/** Dependency-injection token for {@link ProviderCapabilityRepository}. */
export const PROVIDER_CAPABILITY_REPOSITORY = 'PROVIDER_CAPABILITY_REPOSITORY';

export interface ProviderCapabilityRepository {
  createMany(inputs: CreateCapabilityInput[]): Promise<ProviderCapability[]>;

  listByProvider(providerId: string): Promise<ProviderCapability[]>;

  /**
   * Read a single capability by id.
   *
   * Compliance (T007) decides on one capability at a time, and an unknown id
   * must be a `NOT_FOUND` rather than an empty queue.
   */
  findById(id: string): Promise<ProviderCapability | null>;

  findByProviderAndType(
    providerId: string,
    capabilityType: CapabilityType,
  ): Promise<ProviderCapability | null>;

  /**
   * Replace the capability set of a provider.
   *
   * Only used while the application is editable (DRAFT/REJECTED), before any
   * capability has been verified or referenced.
   */
  replaceForProvider(
    providerId: string,
    inputs: CreateCapabilityInput[],
  ): Promise<ProviderCapability[]>;

  /**
   * Admin compliance queue (T007): capabilities in one of the given compliance
   * states, newest first. `capabilityType` narrows the queue to the capabilities
   * that actually require a compliance review.
   */
  listByComplianceStatus(filter: {
    statuses: ComplianceStatus[];
    capabilityType?: CapabilityType;
    limit: number;
  }): Promise<ProviderCapability[]>;

  update(id: string, input: UpdateCapabilityInput): Promise<ProviderCapability>;
}
