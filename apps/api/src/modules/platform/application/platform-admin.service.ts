import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminFeatureFlagListResponse,
  PlatformRuleListResponse,
  PlatformRuleResponse,
} from '@mentor/api-contracts';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { FEATURE_FLAG_REPOSITORY } from '../domain/feature-flag.repository';
import type { FeatureFlagRepository } from '../domain/feature-flag.repository';
import { PLATFORM_RULE_REPOSITORY } from '../domain/platform-rule.repository';
import type { PlatformRuleRepository } from '../domain/platform-rule.repository';
import type { PlatformRule } from '../domain/platform-rule.model';
import {
  assertContentRef,
  assertRuleTransition,
  assertRuleType,
  assertVersion,
} from '../domain/platform-policy';
import { platformNotFound } from '../domain/platform.errors';

export interface PlatformActor {
  actorUserId: string;
  requestId: string;
  ipHash?: string | null;
}

export interface CreatePlatformRuleCommand {
  ruleType: string;
  version: string;
  contentRef: string;
  effectiveAt?: Date | null;
}

/**
 * Platform configuration (`specs/05-api-spec.md` §Admin,
 * `specs/10-privacy-and-minors.md` §Platform rules, `specs/12-admin-spec.md`
 * §Audit).
 *
 * Both mutations here change what the whole platform does, so both are audited:
 * "feature flag production change" and "platform rule publication". A rule is
 * versioned — publishing a new version archives the one it replaces, never
 * rewrites it.
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
    @Inject(PLATFORM_RULE_REPOSITORY) private readonly rules: PlatformRuleRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /** `GET /admin/feature-flags`. */
  async listFlags(): Promise<AdminFeatureFlagListResponse> {
    const flags = await this.flags.list();
    return {
      items: flags.map((flag) => ({
        key: flag.key,
        enabled: flag.enabled,
        updatedAt: flag.updatedAt.toISOString(),
      })),
    };
  }

  /** `PATCH /admin/feature-flags/:key`. */
  async setFlag(
    actor: PlatformActor,
    key: string,
    enabled: boolean,
  ): Promise<{ key: string; enabled: boolean }> {
    const before = await this.flags.isEnabled(key);
    const flag = await this.flags.setEnabled(key, enabled);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.featureFlagChanged,
      resourceType: 'feature_flag',
      resourceId: key,
      beforeJson: { enabled: before },
      afterJson: { enabled: flag.enabled },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { key: flag.key, enabled: flag.enabled };
  }

  /** `GET /admin/platform-rules`. */
  async listRules(ruleType?: string | null): Promise<PlatformRuleListResponse> {
    const rules = await this.rules.list(ruleType ?? null);
    return { items: rules.map(toRuleResponse) };
  }

  /** `POST /admin/platform-rules`: a new draft version. */
  async createRule(
    actor: PlatformActor,
    command: CreatePlatformRuleCommand,
  ): Promise<PlatformRuleResponse> {
    const ruleType = assertRuleType(command.ruleType);
    const version = assertVersion(command.version);
    const contentRef = assertContentRef(command.contentRef);

    const rule = await this.rules.create({
      ruleType,
      version,
      contentRef,
      effectiveAt: command.effectiveAt ?? null,
    });

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.platformRuleCreated,
      resourceType: 'platform_rule',
      resourceId: rule.id,
      beforeJson: null,
      afterJson: { ruleType, version, contentRef, status: rule.status },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return toRuleResponse(rule);
  }

  /**
   * `POST /admin/platform-rules/:id/publish`.
   *
   * Publishing archives the version it replaces, so the text users were shown
   * stays readable (`specs/10` §Platform rules).
   */
  async publishRule(actor: PlatformActor, id: string): Promise<PlatformRuleResponse> {
    const rule = await this.rules.findById(id);
    if (!rule) {
      throw platformNotFound('Platform rule not found.');
    }
    assertRuleTransition(rule.status, 'PUBLISHED');

    const publishedAt = new Date();
    const current = await this.rules.findPublished(rule.ruleType);
    if (current && current.id !== rule.id) {
      await this.rules.setStatus(current.id, 'ARCHIVED', current.publishedAt);
    }

    const updated = await this.rules.setStatus(rule.id, 'PUBLISHED', publishedAt);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.platformRulePublished,
      resourceType: 'platform_rule',
      resourceId: updated.id,
      beforeJson: { status: rule.status, published: current?.version ?? null },
      afterJson: {
        status: updated.status,
        published: updated.version,
        ruleType: updated.ruleType,
        publishedAt: publishedAt.toISOString(),
      },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return toRuleResponse(updated);
  }
}

export function toRuleResponse(rule: PlatformRule): PlatformRuleResponse {
  return {
    id: rule.id,
    ruleType: rule.ruleType,
    version: rule.version,
    status: rule.status,
    contentRef: rule.contentRef,
    effectiveAt: rule.effectiveAt ? rule.effectiveAt.toISOString() : null,
    publishedAt: rule.publishedAt ? rule.publishedAt.toISOString() : null,
    createdAt: rule.createdAt.toISOString(),
  };
}
