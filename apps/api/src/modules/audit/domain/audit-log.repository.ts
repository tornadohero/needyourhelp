import type { AuditActorType } from './audit-log.model';

/** Dependency-injection token for {@link AuditLogRepository}. */
export const AUDIT_LOG_REPOSITORY = 'AUDIT_LOG_REPOSITORY';

/** An audit record to append. Audit rows are never updated or deleted. */
export interface RecordAuditLogInput {
  actorUserId: string | null;
  actorType: AuditActorType;
  /** Stable action name, e.g. `PROVIDER_APPROVED`. */
  action: string;
  resourceType: string;
  resourceId: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  /** Hash of the caller IP; the raw address is never stored (`AGENTS.md` §9). */
  ipHash?: string | null;
  requestId: string;
}

/**
 * Persistence port for `audit_logs`.
 *
 * Every privileged mutation is audited (`AGENTS.md` §7,
 * `specs/06-verification-state-machine.md` §Admin decision requirements).
 */
export interface AuditLogRepository {
  record(input: RecordAuditLogInput): Promise<void>;
}
