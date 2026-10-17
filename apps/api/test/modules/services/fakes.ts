import type { TaxonomyTerm } from '../../../src/modules/catalog/domain/taxonomy.model';
import type { ProviderReadinessGates } from '../../../src/modules/provider/domain/provider-readiness.gates';
import type {
  CreateServiceInput,
  Service,
  ServiceStatus,
  ServiceTermRef,
  UpdateServiceInput,
} from '../../../src/modules/services/domain/service.model';
import type { ServiceRepository } from '../../../src/modules/services/domain/service.repository';

/** Anything that can resolve a taxonomy term id, e.g. the catalog fake. */
export interface TermLookup {
  findById(id: string): Promise<TaxonomyTerm | null>;
}

/**
 * In-memory {@link ServiceRepository}.
 *
 * Terms are resolved on read, exactly like the Prisma adapter joins
 * `service_terms` to `taxonomy_terms`: callers compare codes, never ids.
 */
export class FakeServiceRepository implements ServiceRepository {
  private readonly services = new Map<string, Service>();
  private sequence = 0;

  constructor(private readonly taxonomy: TermLookup) {}

  async create(input: CreateServiceInput): Promise<Service> {
    this.sequence += 1;
    const now = new Date();
    const service: Service = {
      // Shaped like a uuid: a malformed id is treated as not found.
      id: `00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`,
      providerId: input.providerId,
      domain: input.domain,
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      priceMinor: input.priceMinor,
      currency: input.currency,
      deliveryMode: input.deliveryMode,
      // A new service is never sellable: publishing is an explicit command.
      status: 'DRAFT',
      terms: [],
      createdAt: now,
      updatedAt: now,
    };
    this.services.set(service.id, service);
    return this.withTerms(service, input.termIds);
  }

  async findById(id: string): Promise<Service | null> {
    const service = this.services.get(id);
    return service ? await this.resolve(service) : null;
  }

  async listByProvider(providerId: string): Promise<Service[]> {
    const matching = [...this.services.values()].filter(
      (service) => service.providerId === providerId,
    );
    return Promise.all(matching.map((service) => this.resolve(service)));
  }

  async update(id: string, input: UpdateServiceInput): Promise<Service> {
    const current = this.services.get(id);
    if (!current) {
      throw new Error(`unknown service ${id}`);
    }

    const updated: Service = {
      ...current,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
      ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.deliveryMode === undefined ? {} : { deliveryMode: input.deliveryMode }),
      updatedAt: new Date(),
    };
    this.services.set(id, updated);

    return input.termIds === undefined
      ? this.resolve(updated)
      : this.withTerms(updated, input.termIds);
  }

  async setStatus(id: string, status: ServiceStatus): Promise<Service> {
    const current = this.services.get(id);
    if (!current) {
      throw new Error(`unknown service ${id}`);
    }
    const updated: Service = { ...current, status, updatedAt: new Date() };
    this.services.set(id, updated);
    return this.resolve(updated);
  }

  async hasPublished(providerId: string): Promise<boolean> {
    return [...this.services.values()].some(
      (service) => service.providerId === providerId && service.status === 'PUBLISHED',
    );
  }

  /** Test seam: put a service in a state no command can produce in V1. */
  async forceStatus(id: string, status: ServiceStatus): Promise<Service> {
    return this.setStatus(id, status);
  }

  private async withTerms(service: Service, termIds: readonly string[]): Promise<Service> {
    const terms: ServiceTermRef[] = [];
    for (const termId of termIds) {
      const term = await this.taxonomy.findById(termId);
      if (term) {
        terms.push({ termId, type: term.type, code: term.code, name: term.name });
      }
    }
    this.services.set(service.id, { ...service, terms });
    return { ...service, terms };
  }

  private async resolve(service: Service): Promise<Service> {
    const terms: ServiceTermRef[] = [];
    for (const term of service.terms) {
      const found = await this.taxonomy.findById(term.termId);
      if (found) {
        terms.push({ termId: term.termId, type: found.type, code: found.code, name: found.name });
      }
    }
    return { ...service, terms };
  }
}

/**
 * {@link ProviderReadinessGates} whose published-service gate is answered by the
 * fake service repository, so `searchable` really follows publication.
 */
export class ServiceAwareReadinessGates implements ProviderReadinessGates {
  constructor(
    private readonly services: FakeServiceRepository,
    private readonly verificationPassed: boolean,
  ) {}

  async verificationSatisfied(): Promise<boolean> {
    return this.verificationPassed;
  }

  async hasPublishedService(providerId: string): Promise<boolean> {
    return this.services.hasPublished(providerId);
  }
}
