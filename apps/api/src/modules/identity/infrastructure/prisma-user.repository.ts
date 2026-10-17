import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CreateUserInput, Role, UpdateUserProfileInput, User } from '../domain/user.model';
import type { UserRepository } from '../domain/user.repository';

/** Prisma adapter for {@link UserRepository}. */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : null;
  }

  async findByWechatOpenidHash(openidHash: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { wechatOpenidHash: openidHash } });
    return row ? mapUser(row) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const row = await this.prisma.user.create({
      data: {
        wechatOpenidHash: input.wechatOpenidHash ?? null,
        unionidHash: input.unionidHash ?? null,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
      },
    });
    return mapUser(row);
  }

  async createWithRoles(input: CreateUserInput, roles: Role[]): Promise<User> {
    const row = await this.prisma.runInTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          wechatOpenidHash: input.wechatOpenidHash ?? null,
          unionidHash: input.unionidHash ?? null,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl ?? null,
        },
      });

      for (const role of roles) {
        await tx.userRole.upsert({
          where: { userId_role: { userId: user.id, role } },
          create: { userId: user.id, role },
          update: {},
        });
      }

      return user;
    });

    return mapUser(row);
  }

  async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      },
    });
    return mapUser(row);
  }

  async addRole(userId: string, role: Role): Promise<void> {
    await this.prisma.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role },
      update: {},
    });
  }

  async removeRole(userId: string, role: Role): Promise<void> {
    // Idempotent: revoking a role the account does not hold changes nothing.
    await this.prisma.userRole.deleteMany({ where: { userId, role } });
  }

  async listRoles(userId: string): Promise<Role[]> {
    const rows = await this.prisma.userRole.findMany({ where: { userId } });
    return rows.map((row) => row.role);
  }

  async setStatus(userId: string, status: User['status']): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
  }
}

type UserRow = {
  id: string;
  status: User['status'];
  wechatOpenidHash: string | null;
  unionidHash: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/** Maps a Prisma row onto the domain model. Never leaks `phoneEncrypted`. */
function mapUser(row: UserRow): User {
  return {
    id: row.id,
    status: row.status,
    wechatOpenidHash: row.wechatOpenidHash,
    unionidHash: row.unionidHash,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
