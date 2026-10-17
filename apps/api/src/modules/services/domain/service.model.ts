/**
 * Domain view of the service aggregate
 * (`specs/02-domain-model.md` §Service aggregate: "Owns sellable service
 * configuration and price"; `specs/04-database-spec.md` §services /
 * §service_terms).
 *
 * Price is server authoritative (`specs/01-business-rules.md` §Service): it is
 * validated here and orders (T013) snapshot it, so a client never decides what
 * a service costs.
 */

export type ServiceDomain = 'TUTORING' | 'CAREER';

/** `specs/06-verification-state-machine.md` §Service publication. */
export type ServiceStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'UNPUBLISHED';

export type DeliveryMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';

/**
 * A resolved taxonomy tag of a service.
 *
 * `service_terms` only stores a term id; the code is what compliance scopes
 * (T007), discovery filters (T010) and order snapshots compare against.
 */
export interface ServiceTermRef {
  termId: string;
  type: 'SUBJECT' | 'GRADE' | 'SKILL' | 'CITY';
  code: string;
  name: string;
}

export interface Service {
  id: string;
  providerId: string;
  domain: ServiceDomain;
  title: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  deliveryMode: DeliveryMode;
  status: ServiceStatus;
  terms: ServiceTermRef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceInput {
  providerId: string;
  domain: ServiceDomain;
  title: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  deliveryMode: DeliveryMode;
  /** Resolved `taxonomy_terms.id` values, never client-supplied ids. */
  termIds: string[];
}

/** Partial update; `status` is changed only by the publish commands. */
export interface UpdateServiceInput {
  title?: string;
  description?: string | null;
  durationMinutes?: number;
  priceMinor?: number;
  currency?: string;
  deliveryMode?: DeliveryMode;
  termIds?: string[];
}

/**
 * The facts an order needs (T013) and a compliance check judges
 * (`specs/06` §Teacher compliance: category and location).
 */
export interface ServiceFacts {
  id: string;
  providerId: string;
  domain: ServiceDomain;
  title: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  status: ServiceStatus;
  /** Service taxonomy codes, upper-cased, for the compliance scope check. */
  subjectCodes: string[];
  cityCode: string | null;
}
