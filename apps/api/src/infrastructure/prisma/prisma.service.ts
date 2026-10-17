import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

/**
 * Application-wide Prisma client.
 *
 * Infrastructure only: no module may import `PrismaClient` directly. Domain and
 * application code depends on repository interfaces
 * (`AGENTS.md` §6 — repository abstraction).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run a unit of work in a single transaction.
   *
   * `AGENTS.md` §6: state changes that must be atomic must use a transaction.
   */
  async runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(work);
  }
}
