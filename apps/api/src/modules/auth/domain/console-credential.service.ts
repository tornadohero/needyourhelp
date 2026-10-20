import type { ApiRole } from '@mentor/api-contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { authForbidden } from './auth-errors';
import { CONSOLE_CREDENTIAL_REPOSITORY } from './console-credential.repository';
import type { ConsoleCredentialRepository } from './console-credential.repository';
import {
  assertPassword,
  assertUsername,
  CONSOLE_ROLES,
  hasAnyRole,
} from './console-credential-policy';
import { CONSOLE_PASSWORD_HASHER } from './password-hasher';
import type { ConsolePasswordHasher } from './password-hasher';

export interface ConsoleCredentialActor {
  actorUserId: string;
  ipHash?: string | null;
  requestId: string;
}

/**
 * Managing admin console credentials (T028 gap G1).
 *
 * A credential is only ever issued to an account that **already** holds `ADMIN`
 * or `OPS`: login never grants a role, it only proves one. Issuing, rotating and
 * revoking are privileged mutations and are audited like any other
 * (`AGENTS.md` §7). The password itself is never returned, logged or audited.
 */
@Injectable()
export class ConsoleCredentialService {
  constructor(
    @Inject(CONSOLE_CREDENTIAL_REPOSITORY)
    private readonly credentials: ConsoleCredentialRepository,
    @Inject(CONSOLE_PASSWORD_HASHER) private readonly passwords: ConsolePasswordHasher,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /** `POST /admin/console-credentials`: issue or rotate. */
  async issue(
    actor: ConsoleCredentialActor,
    input: { userId: string; username: string; password: string },
  ): Promise<{ userId: string; username: string; rotated: boolean }> {
    const username = assertUsername(input.username);
    assertPassword(input.password);

    const user = await this.users.findById(input.userId);
    if (!user) {
      throw authForbidden('That account does not exist.');
    }

    const roles = (await this.users.listRoles(user.id)) as ApiRole[];
    if (!hasAnyRole(roles, CONSOLE_ROLES)) {
      // Never a silent downgrade: the console is for operators only.
      throw authForbidden('Only an ADMIN or OPS account may hold a console credential.');
    }

    const before = await this.credentials.findByUserId(user.id);
    const passwordHash = await this.passwords.hash(input.password);
    const stored = await this.credentials.upsert({
      userId: user.id,
      username,
      passwordHash,
    });

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.consoleCredentialIssued,
      resourceType: 'console_credential',
      resourceId: stored.id,
      // An allowlist: the hash is deliberately absent from both snapshots.
      beforeJson: { hasCredential: before !== null, username: before?.username ?? null },
      afterJson: { hasCredential: true, username: stored.username, rotated: before !== null },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { userId: stored.userId, username: stored.username, rotated: before !== null };
  }

  /** `DELETE /admin/console-credentials/:userId`: revoke console access. */
  async revoke(
    actor: ConsoleCredentialActor,
    userId: string,
  ): Promise<{ userId: string; revoked: boolean }> {
    const before = await this.credentials.findByUserId(userId);
    if (!before) {
      throw authForbidden('That account has no console credential.');
    }

    await this.credentials.deleteByUserId(userId);

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.consoleCredentialRevoked,
      resourceType: 'console_credential',
      resourceId: before.id,
      beforeJson: { hasCredential: true, username: before.username },
      afterJson: { hasCredential: false, username: null },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return { userId, revoked: true };
  }
}
