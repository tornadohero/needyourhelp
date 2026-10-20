import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ConsoleCredentialRecord,
  ConsoleCredentialRepository,
} from '../domain/console-credential.repository';

@Injectable()
export class PrismaConsoleCredentialRepository implements ConsoleCredentialRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByUsername(username: string): Promise<ConsoleCredentialRecord | null> {
    const row = await this.prisma.consoleCredential.findUnique({ where: { username } });
    return row ? map(row) : null;
  }

  async findByUserId(userId: string): Promise<ConsoleCredentialRecord | null> {
    const row = await this.prisma.consoleCredential.findFirst({ where: { userId } });
    return row ? map(row) : null;
  }

  async upsert(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<ConsoleCredentialRecord> {
    // One credential per account: issuing again rotates the password in place.
    const existing = await this.prisma.consoleCredential.findFirst({
      where: { userId: input.userId },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.consoleCredential.update({
          where: { id: existing.id },
          data: {
            username: input.username,
            passwordHash: input.passwordHash,
            // A rotation clears a lock: the operator is back in control.
            failedAttempts: 0,
            lockedUntil: null,
          },
        })
      : await this.prisma.consoleCredential.create({
          data: {
            userId: input.userId,
            username: input.username,
            passwordHash: input.passwordHash,
          },
        });

    return map(row);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.consoleCredential.deleteMany({ where: { userId } });
  }

  async recordFailure(input: {
    id: string;
    failedAttempts: number;
    lockedUntil: Date | null;
  }): Promise<ConsoleCredentialRecord> {
    const row = await this.prisma.consoleCredential.update({
      where: { id: input.id },
      data: { failedAttempts: input.failedAttempts, lockedUntil: input.lockedUntil },
    });
    return map(row);
  }

  async recordSuccess(id: string): Promise<ConsoleCredentialRecord> {
    const row = await this.prisma.consoleCredential.update({
      where: { id },
      data: { failedAttempts: 0, lockedUntil: null, lastUsedAt: new Date() },
    });
    return map(row);
  }
}

type Row = {
  id: string;
  userId: string;
  username: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function map(row: Row): ConsoleCredentialRecord {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    passwordHash: row.passwordHash,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
