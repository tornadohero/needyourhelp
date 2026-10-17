import type { Prisma, Session } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AuthSession,
  CreateSessionInput,
  SessionRevokedReason,
} from '../domain/auth-session.model';
import type { SessionRepository } from '../domain/session.repository';

/** Prisma adapter for {@link SessionRepository}. */
@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<AuthSession> {
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        deviceLabel: input.deviceLabel ?? null,
        ipHash: input.ipHash ?? null,
        userAgentHash: input.userAgentHash ?? null,
      },
    });
    return mapSession(row);
  }

  async findById(id: string): Promise<AuthSession | null> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    return row ? mapSession(row) : null;
  }

  async findByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSession | null> {
    const row = await this.prisma.session.findUnique({ where: { refreshTokenHash } });
    return row ? mapSession(row) : null;
  }

  async rotate(input: {
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    reason: SessionRevokedReason;
  }): Promise<AuthSession> {
    return this.prisma.runInTransaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.session.findUnique({ where: { id: input.sessionId } });
      if (!current) {
        throw new Error(`Session ${input.sessionId} not found.`);
      }

      const created = await tx.session.create({
        data: {
          userId: current.userId,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
          deviceLabel: current.deviceLabel,
          ipHash: current.ipHash,
          userAgentHash: current.userAgentHash,
          rotatedFromSessionId: current.id,
        },
      });

      await tx.session.update({
        where: { id: current.id },
        data: { revokedAt: new Date(), revokedReason: input.reason },
      });

      return mapSession(created);
    });
  }

  async revoke(sessionId: string, reason: SessionRevokedReason): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeChain(rootSessionId: string, reason: SessionRevokedReason): Promise<string[]> {
    return this.prisma.runInTransaction(async (tx: Prisma.TransactionClient) => {
      const revokedAt = new Date();
      const revoked: string[] = [];
      const visited = new Set<string>();
      const queue: string[] = [rootSessionId];

      while (queue.length > 0) {
        const sessionId = queue.shift();
        if (!sessionId || visited.has(sessionId)) {
          continue;
        }
        visited.add(sessionId);

        const children = await tx.session.findMany({
          where: { rotatedFromSessionId: sessionId },
          select: { id: true },
        });

        await tx.session.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt, revokedReason: reason },
        });
        revoked.push(sessionId);

        for (const child of children) {
          queue.push(child.id);
        }
      }

      return revoked;
    });
  }

  async setAccessTokenJti(sessionId: string, jti: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { accessTokenJti: jti } });
  }
}

function mapSession(row: Session): AuthSession {
  return {
    id: row.id,
    userId: row.userId,
    refreshTokenHash: row.refreshTokenHash,
    accessTokenJti: row.accessTokenJti,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    rotatedFromSessionId: row.rotatedFromSessionId,
    createdAt: row.createdAt,
  };
}
