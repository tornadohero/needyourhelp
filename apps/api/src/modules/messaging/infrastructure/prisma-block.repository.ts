import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { BlockRecord, BlockRepository } from '../domain/block.repository';

/** Prisma adapter for {@link BlockRepository}. */
@Injectable()
export class PrismaBlockRepository implements BlockRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async add(blockerUserId: string, blockedUserId: string): Promise<BlockRecord> {
    // `blocks` has a composite primary key: blocking twice is a no-op.
    await this.prisma.block.upsert({
      where: {
        blockerUserId_blockedUserId: { blockerUserId, blockedUserId },
      },
      create: { blockerUserId, blockedUserId },
      update: {},
    });

    const row = await this.prisma.block.findUniqueOrThrow({
      where: { blockerUserId_blockedUserId: { blockerUserId, blockedUserId } },
    });
    return mapBlock(row);
  }

  async remove(blockerUserId: string, blockedUserId: string): Promise<boolean> {
    const deleted = await this.prisma.block.deleteMany({
      where: { blockerUserId, blockedUserId },
    });
    return deleted.count === 1;
  }

  /** A block counts in both directions (`specs/09-im-spec.md` §Safety). */
  async existsBetween(firstUserId: string, secondUserId: string): Promise<boolean> {
    const count = await this.prisma.block.count({
      where: {
        OR: [
          { blockerUserId: firstUserId, blockedUserId: secondUserId },
          { blockerUserId: secondUserId, blockedUserId: firstUserId },
        ],
      },
    });
    return count > 0;
  }
}

function mapBlock(row: {
  blockerUserId: string;
  blockedUserId: string;
  createdAt: Date;
}): BlockRecord {
  return {
    blockerUserId: row.blockerUserId,
    blockedUserId: row.blockedUserId,
    createdAt: row.createdAt,
  };
}
