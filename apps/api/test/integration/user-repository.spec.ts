import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import {
  createTestPrisma,
  describeWithDatabase,
  fixtureKey,
  isUniqueConstraintError,
} from './helpers/test-database';

/**
 * Repository adapter tests for the identity aggregate.
 *
 * The adapter is driven through `PrismaService` (the same object NestJS injects)
 * and must never leak `phoneEncrypted` or raw WeChat identifiers.
 */
describeWithDatabase('PrismaUserRepository', () => {
  const prisma: PrismaClient = createTestPrisma();
  let repository: PrismaUserRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaUserRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { displayName: { startsWith: 'repo-itest-' } } });
    await prisma.$disconnect();
  });

  it('creates and reads a user by id and by openid hash', async () => {
    const openidHash = fixtureKey('openid');
    const displayName = `repo-itest-${fixtureKey('user')}`;

    const created = await repository.create({ wechatOpenidHash: openidHash, displayName });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe('ACTIVE');
    expect(created.displayName).toBe(displayName);

    const byId = await repository.findById(created.id);
    expect(byId?.id).toBe(created.id);

    const byHash = await repository.findByWechatOpenidHash(openidHash);
    expect(byHash?.id).toBe(created.id);
  });

  it('never exposes the encrypted phone number through the repository', async () => {
    const openidHash = fixtureKey('openid');
    const displayName = `repo-itest-${fixtureKey('private')}`;

    await prisma.user.create({
      data: { wechatOpenidHash: openidHash, displayName, phoneEncrypted: 'ciphertext' },
    });

    const user = await repository.findByWechatOpenidHash(openidHash);

    expect(user).not.toBeNull();
    expect(Object.keys(user ?? {}).sort()).toEqual(
      [
        'avatarUrl',
        'createdAt',
        'deletedAt',
        'displayName',
        'id',
        'status',
        'unionidHash',
        'updatedAt',
        'wechatOpenidHash',
      ].sort(),
    );
  });

  it('assigns roles idempotently and lists them', async () => {
    const created = await repository.create({
      wechatOpenidHash: fixtureKey('openid'),
      displayName: `repo-itest-${fixtureKey('roles')}`,
    });

    await repository.addRole(created.id, 'PARENT');
    await repository.addRole(created.id, 'PARENT');
    await repository.addRole(created.id, 'PROVIDER');

    expect((await repository.listRoles(created.id)).sort()).toEqual(['PARENT', 'PROVIDER']);
  });

  it('suspends and restores an account without deleting it', async () => {
    const created = await repository.create({
      wechatOpenidHash: fixtureKey('openid'),
      displayName: `repo-itest-${fixtureKey('status')}`,
    });

    await repository.setStatus(created.id, 'SUSPENDED');
    expect((await repository.findById(created.id))?.status).toBe('SUSPENDED');

    await repository.setStatus(created.id, 'ACTIVE');
    const restored = await repository.findById(created.id);
    expect(restored?.status).toBe('ACTIVE');
    expect(restored?.deletedAt).toBeNull();
  });

  it('rejects a duplicated WeChat openid hash', async () => {
    const openidHash = fixtureKey('openid');
    await repository.create({
      wechatOpenidHash: openidHash,
      displayName: `repo-itest-${fixtureKey('dup')}`,
    });

    let error: unknown;
    try {
      await repository.create({ wechatOpenidHash: openidHash, displayName: 'repo-itest-dup-2' });
    } catch (caught) {
      error = caught;
    }

    expect(isUniqueConstraintError(error)).toBe(true);
  });
});
