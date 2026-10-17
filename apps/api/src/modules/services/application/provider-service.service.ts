import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { TAXONOMY_REPOSITORY } from '../../catalog/domain/taxonomy.repository';
import type { TaxonomyRepository } from '../../catalog/domain/taxonomy.repository';
import { isUuid } from '../../catalog/domain/taxonomy-policy';
import type { ProviderProfile, ProviderType } from '../../provider/domain/provider-profile.model';
import { ProviderApplicationService } from '../../provider/application/provider-application.service';
import {
  serviceForbidden,
  serviceInvalidState,
  serviceNotFound,
  serviceNotPublished,
} from '../domain/service.errors';
import {
  assertCurrency,
  assertDescription,
  assertDurationMinutes,
  assertPriceMinor,
  assertTagging,
  assertTitle,
  canTransition,
  isEditable,
  isPublished,
  normalizeTermCodes,
} from '../domain/service-policy';
import type { Service, ServiceFacts, ServiceStatus, ServiceTermRef } from '../domain/service.model';
import { SERVICE_REPOSITORY } from '../domain/service.repository';
import type { ServiceRepository } from '../domain/service.repository';

/** Taxonomy codes a client may tag a service with. */
export interface ServiceTermCodes {
  subjectCodes?: readonly string[];
  gradeCodes?: readonly string[];
  skillCodes?: readonly string[];
  cityCodes?: readonly string[];
}

export interface CreateServiceCommand extends ServiceTermCodes {
  title: string;
  description?: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency?: string;
  deliveryMode?: Service['deliveryMode'];
}

export interface UpdateServiceCommand extends ServiceTermCodes {
  title?: string;
  description?: string | null;
  durationMinutes?: number;
  priceMinor?: number;
  currency?: string;
  deliveryMode?: Service['deliveryMode'];
}

const TERM_GROUPS: readonly { type: ServiceTermRef['type']; key: keyof ServiceTermCodes }[] = [
  { type: 'SUBJECT', key: 'subjectCodes' },
  { type: 'GRADE', key: 'gradeCodes' },
  { type: 'SKILL', key: 'skillCodes' },
  { type: 'CITY', key: 'cityCodes' },
];

/**
 * Provider services (`specs/05-api-spec.md` §Services).
 *
 * The service aggregate owns the sellable configuration and the price
 * (`specs/02-domain-model.md`): price and duration are validated here, never in
 * a controller and never by a client, and only an explicit command changes the
 * publication state.
 *
 * Dependency direction: services reads the taxonomy (T008) through its port and
 * asks the provider context (T005) for the application and for the publication
 * gate. The provider context never reads `services`; it consumes the
 * `SERVICE_READINESS` port implemented in `infrastructure/`.
 */
@Injectable()
export class ProviderServiceService {
  constructor(
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepository,
    @Inject(ProviderApplicationService)
    private readonly applications: ProviderApplicationService,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `POST /providers/me/services`: always created as a `DRAFT`. */
  async create(
    userId: string,
    providerType: ProviderType,
    input: CreateServiceCommand,
  ): Promise<Service> {
    // The career marketplace is flagged: no career service exists while it is
    // off (T021).
    await this.applications.assertMarketplaceOpen(providerType);
    const { profile } = await this.applications.getMyApplication(userId, providerType);

    const title = assertTitle(input.title);
    const description = assertDescription(input.description);
    const durationMinutes = assertDurationMinutes(input.durationMinutes);
    const priceMinor = assertPriceMinor(input.priceMinor);
    const currency = assertCurrency(input.currency ?? 'CNY');
    const terms = await this.resolveTerms(input);
    assertTagging(profile.providerType, terms);

    const created = await this.services.create({
      providerId: profile.id,
      // The domain follows the provider: a client never chooses it.
      domain: profile.providerType,
      title,
      description,
      durationMinutes,
      priceMinor,
      currency,
      deliveryMode: input.deliveryMode ?? 'ONLINE',
      termIds: terms.map((term) => term.termId),
    });

    return { ...created, terms };
  }

  /** `GET /providers/me/services`: own services, newest first. */
  async listMine(userId: string, providerType: ProviderType): Promise<Service[]> {
    const { profile } = await this.applications.getMyApplication(userId, providerType);
    return this.services.listByProvider(profile.id);
  }

  /**
   * `PATCH /providers/me/services/:id`: only while the service is not published.
   *
   * A published service is what a customer sees and what an order snapshots, so
   * changing it silently is never allowed: unpublish first.
   */
  async update(
    userId: string,
    providerType: ProviderType,
    serviceId: string,
    input: UpdateServiceCommand,
  ): Promise<Service> {
    const { service } = await this.requireOwned(userId, providerType, serviceId);

    if (!isEditable(service.status)) {
      throw serviceInvalidState(
        `A service in status ${service.status} cannot be edited; unpublish it first.`,
      );
    }

    const terms = await this.resolveUpdateTerms(service, input);
    if (terms !== undefined) {
      assertTagging(service.domain, terms);
    }

    const updated = await this.services.update(service.id, {
      ...(input.title === undefined ? {} : { title: assertTitle(input.title) }),
      ...(input.description === undefined
        ? {}
        : { description: assertDescription(input.description) }),
      ...(input.durationMinutes === undefined
        ? {}
        : { durationMinutes: assertDurationMinutes(input.durationMinutes) }),
      ...(input.priceMinor === undefined ? {} : { priceMinor: assertPriceMinor(input.priceMinor) }),
      ...(input.currency === undefined ? {} : { currency: assertCurrency(input.currency) }),
      ...(input.deliveryMode === undefined ? {} : { deliveryMode: input.deliveryMode }),
      ...(terms === undefined ? {} : { termIds: terms.map((term) => term.termId) }),
    });

    return terms === undefined ? updated : { ...updated, terms };
  }

  /**
   * `POST /providers/me/services/:id/publish`.
   *
   * The gate is the approved provider (`specs/01-business-rules.md` §Provider
   * approval: "Provider cannot publish before approval"), checked by T005's
   * single `assertCanPublish`, so a provider can never publish itself into the
   * marketplace.
   */
  async publish(userId: string, providerType: ProviderType, serviceId: string): Promise<Service> {
    const { service, profile } = await this.requireOwned(userId, providerType, serviceId);

    // Raises PROVIDER_NOT_APPROVED (409) before anything is written, and
    // refuses a career service while the career marketplace is off.
    await this.applications.assertCanPublish(userId, providerType);

    const updated = await this.transition(service, 'PUBLISHED');
    await this.applications.refreshSearchable(profile);

    await this.analytics?.track({
      name: 'service_published',
      actorUserId: userId,
      providerId: profile.id,
      serviceId: updated.id,
      props: { price_minor: updated.priceMinor },
    });

    return updated;
  }

  /** `POST /providers/me/services/:id/unpublish`: the way back to editable. */
  async unpublish(userId: string, providerType: ProviderType, serviceId: string): Promise<Service> {
    const { service, profile } = await this.requireOwned(userId, providerType, serviceId);

    const updated = await this.transition(service, 'UNPUBLISHED');
    await this.applications.refreshSearchable(profile);
    return updated;
  }

  /**
   * The service half of the order gate (T013).
   *
   * `specs/02-domain-model.md`: "Service cannot be ordered unless provider and
   * service are active." T013 still has to combine this with the provider
   * approval (T005) and teacher compliance (T007) gates — passing here alone
   * never makes a service orderable.
   */
  async assertOrderable(serviceId: string): Promise<ServiceFacts> {
    const service = await this.services.findById(serviceId);
    if (!service) {
      throw serviceNotFound();
    }
    if (!isPublished(service.status)) {
      throw serviceNotPublished(
        `Service in status ${service.status} cannot be ordered; it must be PUBLISHED.`,
      );
    }

    return {
      id: service.id,
      providerId: service.providerId,
      domain: service.domain,
      title: service.title,
      durationMinutes: service.durationMinutes,
      priceMinor: service.priceMinor,
      currency: service.currency,
      status: service.status,
      subjectCodes: service.terms
        .filter((term) => term.type === 'SUBJECT')
        .map((term) => term.code),
      cityCode: service.terms.find((term) => term.type === 'CITY')?.code ?? null,
    };
  }

  /** Load a service and prove it belongs to the caller's provider profile. */
  private async requireOwned(
    userId: string,
    providerType: ProviderType,
    serviceId: string,
  ): Promise<{ service: Service; profile: ProviderProfile }> {
    const { profile } = await this.applications.getMyApplication(userId, providerType);

    // Ids are opaque: an unparseable id is simply not found and never reaches
    // the database as a malformed uuid.
    if (!isUuid(serviceId)) {
      throw serviceNotFound();
    }

    const service = await this.services.findById(serviceId);
    if (!service) {
      throw serviceNotFound();
    }
    if (service.providerId !== profile.id) {
      throw serviceForbidden('This service belongs to another provider.');
    }

    return { service, profile };
  }

  /** Explicit state command: only a transition the state machine allows. */
  private async transition(service: Service, to: ServiceStatus): Promise<Service> {
    if (!canTransition(service.status, to)) {
      throw serviceInvalidState(`Illegal service transition ${service.status} -> ${to}.`);
    }
    return this.services.setStatus(service.id, to);
  }

  /** Resolve every supplied taxonomy code; unknown or archived codes are refused. */
  private async resolveTerms(input: ServiceTermCodes): Promise<ServiceTermRef[]> {
    const resolved: ServiceTermRef[] = [];

    for (const group of TERM_GROUPS) {
      for (const code of normalizeTermCodes(input[group.key])) {
        resolved.push(await this.resolveTerm(group.type, code));
      }
    }

    return resolved;
  }

  /**
   * Resolve the tags of an update: a type that is not supplied keeps the terms
   * the service already carries.
   */
  private async resolveUpdateTerms(
    service: Service,
    input: UpdateServiceCommand,
  ): Promise<ServiceTermRef[] | undefined> {
    if (TERM_GROUPS.every((group) => input[group.key] === undefined)) {
      return undefined;
    }

    const resolved: ServiceTermRef[] = [];
    for (const group of TERM_GROUPS) {
      const codes = input[group.key];
      if (codes === undefined) {
        resolved.push(...service.terms.filter((term) => term.type === group.type));
        continue;
      }
      for (const code of normalizeTermCodes(codes)) {
        resolved.push(await this.resolveTerm(group.type, code));
      }
    }

    return dedupe(resolved);
  }

  private async resolveTerm(type: ServiceTermRef['type'], code: string): Promise<ServiceTermRef> {
    const term = await this.taxonomy.findByCode(type, code);
    if (!term) {
      throw serviceInvalidState(`Unknown ${type} code ${code}.`);
    }
    // An archived term is not selectable: T009/T010 only ever tag with active
    // terms (`specs/05-api-spec.md` §Taxonomy).
    if (!term.active) {
      throw serviceInvalidState(`${type} code ${code} is archived and cannot be used.`);
    }
    return { termId: term.id, type, code: term.code, name: term.name };
  }
}

function dedupe(terms: readonly ServiceTermRef[]): ServiceTermRef[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    if (seen.has(term.termId)) {
      return false;
    }
    seen.add(term.termId);
    return true;
  });
}
