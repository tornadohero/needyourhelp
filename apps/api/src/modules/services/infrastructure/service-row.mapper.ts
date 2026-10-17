import type { Service, ServiceStatus, ServiceTermRef } from '../domain/service.model';

/**
 * Row -> domain mapping for `services`.
 *
 * Shared by the service repository (T009) and the discovery read model (T010)
 * so a column added later is mapped in exactly one place.
 */

/** `service_terms` joined to the term: callers compare codes, not ids. */
export const SERVICE_TERMS_INCLUDE = { terms: { include: { term: true } } } as const;

export type ServiceRow = {
  id: string;
  providerId: string;
  domain: Service['domain'];
  title: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  deliveryMode: Service['deliveryMode'];
  status: ServiceStatus;
  createdAt: Date;
  updatedAt: Date;
  terms: {
    termId: string;
    term: {
      id: string;
      type: ServiceTermRef['type'];
      code: string;
      name: string;
    };
  }[];
};

export function mapServiceRow(row: ServiceRow): Service {
  return {
    id: row.id,
    providerId: row.providerId,
    domain: row.domain,
    title: row.title,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceMinor: row.priceMinor,
    currency: row.currency,
    deliveryMode: row.deliveryMode,
    status: row.status,
    terms: row.terms.map((link) => ({
      termId: link.termId,
      type: link.term.type,
      code: link.term.code,
      name: link.term.name,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
