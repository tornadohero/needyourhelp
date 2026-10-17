import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { taxonomyInvalid, taxonomyNotFound } from '../domain/taxonomy.errors';
import {
  MAX_TAXONOMY_TREE_DEPTH,
  assertUsableParent,
  isAncestor,
  isUuid,
  normalizeTaxonomyCode,
  normalizeTaxonomyName,
} from '../domain/taxonomy-policy';
import type {
  CreateTaxonomyTermInput,
  TaxonomyTerm,
  TaxonomyTermPage,
  TaxonomyTermQuery,
  UpdateTaxonomyTermInput,
} from '../domain/taxonomy.model';
import { TAXONOMY_REPOSITORY } from '../domain/taxonomy.repository';
import type { TaxonomyRepository } from '../domain/taxonomy.repository';

/** Context every taxonomy mutation carries (`specs/12-admin-spec.md` §Audit). */
export interface TaxonomyMutationContext {
  actorUserId: string;
  requestId: string;
  ipHash?: string | null;
}

/** `taxonomy_terms` is the audit resource type of the catalog context. */
const RESOURCE_TYPE = 'taxonomy_term';

/**
 * Admin taxonomy management (`specs/05-api-spec.md` §Taxonomy).
 *
 * The taxonomy is platform configuration, so only an admin changes it and every
 * mutation is audited with a before/after snapshot (`specs/12-admin-spec.md`:
 * "Every mutation audited", "No silent data edits").
 *
 * Terms are archived, never deleted: `service_terms` references them and
 * historical orders depend on the taxonomy snapshot.
 */
@Injectable()
export class TaxonomyAdminService {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly terms: TaxonomyRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /** `GET /admin/taxonomy`: a bounded, filtered page. */
  async list(query: TaxonomyTermQuery): Promise<TaxonomyTermPage> {
    return this.terms.list(query);
  }

  /** `POST /admin/taxonomy`. */
  async create(
    input: CreateTaxonomyTermInput,
    context: TaxonomyMutationContext,
  ): Promise<TaxonomyTerm> {
    const code = normalizeTaxonomyCode(input.code);
    const name = normalizeTaxonomyName(input.name);
    const parentId = await this.resolveParent(input.parentId ?? null, {
      type: input.type,
    });

    // `(type, code)` is unique in the database; fail with a readable message
    // instead of surfacing a driver error.
    const existing = await this.terms.findByCode(input.type, code);
    if (existing) {
      throw taxonomyInvalid(`A ${input.type} term with code ${code} already exists.`);
    }

    const created = await this.terms.create({
      type: input.type,
      code,
      name,
      parentId,
    });

    await this.record(context, AUDIT_ACTIONS.taxonomyCreated, created.id, null, created);
    return created;
  }

  /** `PATCH /admin/taxonomy/:id`. */
  async update(
    id: string,
    input: UpdateTaxonomyTermInput,
    context: TaxonomyMutationContext,
  ): Promise<TaxonomyTerm> {
    const current = await this.requireTerm(id);

    const name = input.name === undefined ? undefined : normalizeTaxonomyName(input.name);
    const parentId =
      input.parentId === undefined
        ? undefined
        : await this.resolveParent(input.parentId, { id: current.id, type: current.type });
    const active = input.active;

    if (name === undefined && parentId === undefined && active === undefined) {
      // Nothing to change: an empty patch is a no-op and writes no audit row.
      return current;
    }

    // Moving a term under its own descendant would detach the whole branch.
    if (parentId !== undefined && parentId !== null) {
      await this.assertNoCycle(current.id, parentId);
    }

    const updated = await this.terms.update(id, {
      ...(name === undefined ? {} : { name }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(active === undefined ? {} : { active }),
    });

    await this.record(context, AUDIT_ACTIONS.taxonomyUpdated, updated.id, current, updated);
    return updated;
  }

  /**
   * `POST /admin/taxonomy/:id/archive`: set `active=false`.
   *
   * Idempotent: archiving an archived term changes nothing and writes no audit
   * row. Children are left untouched — the spec defines no cascade, and an
   * archived parent only stops new children from being attached.
   */
  async archive(id: string, context: TaxonomyMutationContext): Promise<TaxonomyTerm> {
    const current = await this.requireTerm(id);
    if (!current.active) {
      return current;
    }

    const updated = await this.terms.update(id, { active: false });
    await this.record(context, AUDIT_ACTIONS.taxonomyArchived, updated.id, current, updated);
    return updated;
  }

  private async requireTerm(id: string): Promise<TaxonomyTerm> {
    // Ids are opaque: an unparseable id is simply not found, and never reaches
    // the database as a malformed uuid.
    if (!isUuid(id)) {
      throw taxonomyNotFound();
    }
    const term = await this.terms.findById(id);
    if (!term) {
      throw taxonomyNotFound();
    }
    return term;
  }

  /** Validate a proposed parent and return the id to store. */
  private async resolveParent(
    parentId: string | null,
    child: { id?: string; type: TaxonomyTerm['type'] },
  ): Promise<string | null> {
    if (parentId === null) {
      return null;
    }
    if (!isUuid(parentId)) {
      throw taxonomyInvalid('A taxonomy parent must be a term id.');
    }

    const parent = await this.terms.findById(parentId);
    if (!parent) {
      throw taxonomyNotFound('Parent taxonomy term not found.');
    }
    assertUsableParent(parent, child);
    return parent.id;
  }

  private async assertNoCycle(termId: string, parentId: string): Promise<void> {
    const chain: { id: string; parentId: string | null }[] = [];
    let cursor: string | null = parentId;

    while (cursor !== null) {
      const parent = await this.terms.findById(cursor);
      if (!parent) {
        break;
      }
      chain.push(parent);
      if (isAncestor(termId, chain)) {
        throw taxonomyInvalid('A taxonomy term cannot be moved under its own descendant.');
      }
      if (chain.length > MAX_TAXONOMY_TREE_DEPTH) {
        throw taxonomyInvalid(
          `A taxonomy tree may not be deeper than ${MAX_TAXONOMY_TREE_DEPTH} levels.`,
        );
      }
      cursor = parent.parentId;
    }
  }

  private async record(
    context: TaxonomyMutationContext,
    action: string,
    resourceId: string,
    before: TaxonomyTerm | null,
    after: TaxonomyTerm,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action,
      resourceType: RESOURCE_TYPE,
      resourceId,
      beforeJson: before === null ? null : snapshot(before),
      afterJson: snapshot(after),
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });
  }
}

/** Fields a taxonomy decision may change; the audit trail is append-only. */
function snapshot(term: TaxonomyTerm): Record<string, unknown> {
  return {
    type: term.type,
    code: term.code,
    name: term.name,
    parentId: term.parentId,
    active: term.active,
  };
}
