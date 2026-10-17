import type {
  CreateServiceInput,
  Service,
  ServiceStatus,
  UpdateServiceInput,
} from './service.model';

/** Dependency-injection token for {@link ServiceRepository}. */
export const SERVICE_REPOSITORY = 'SERVICE_REPOSITORY';

/**
 * Persistence port for the service aggregate.
 *
 * There is no delete: a service is unpublished, and orders reference it, so
 * history must stay resolvable (`specs/02-domain-model.md` §State invariants).
 *
 * `status` is written by {@link ServiceRepository.setStatus} only, which keeps
 * the transition check in the application layer.
 */
export interface ServiceRepository {
  create(input: CreateServiceInput): Promise<Service>;

  /** Terms are resolved with the service: the code is what callers compare. */
  findById(id: string): Promise<Service | null>;

  /** `GET /providers/me/services`: newest first, own services only. */
  listByProvider(providerId: string): Promise<Service[]>;

  update(id: string, input: UpdateServiceInput): Promise<Service>;

  setStatus(id: string, status: ServiceStatus): Promise<Service>;

  /** Discovery gate (`specs/01-business-rules.md` §Provider approval). */
  hasPublished(providerId: string): Promise<boolean>;
}
