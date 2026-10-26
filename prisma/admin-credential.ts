/**
 * Dev-only helper: issue (or reset) a console credential for an ADMIN account.
 *
 * `pnpm admin:credential <username> <password>`
 *
 * Why this exists: `POST /admin/bootstrap` refuses once any account holds
 * `ADMIN`, and the base seed creates `Platform Admin` with that role on
 * purpose — so on a seeded dev database the documented first-run path cannot
 * run, and `POST /admin/console-credentials` needs an ADMIN session that does
 * not exist yet. This script closes that gap for local development only: it
 * writes the credential with the **server's own** `ScryptPasswordHasher`, so
 * the row is exactly what `POST /auth/console/login` expects.
 *
 * It refuses to run against production and it never prints the hash.
 */
import { PrismaClient } from '@prisma/client';

import { ScryptPasswordHasher } from '../apps/api/src/modules/auth/domain/password-hasher';

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error('usage: pnpm admin:credential <username> <password>');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('the password must be at least 12 characters (console-credential-policy).');
    process.exit(1);
  }

  const client = new PrismaClient();
  try {
    const admin = await client.user.findFirst({
      where: { roles: { some: { role: 'ADMIN' } }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (admin === null) {
      console.error('no account holds the ADMIN role — run `pnpm prisma:seed` first.');
      process.exit(1);
    }

    const hash = await new ScryptPasswordHasher().hash(password);

    const existing = await client.consoleCredential.findUnique({ where: { username } });
    if (existing !== null && existing.userId !== admin.id) {
      console.error(`username "${username}" already belongs to another account.`);
      process.exit(1);
    }

    if (existing === null) {
      await client.consoleCredential.create({
        data: { userId: admin.id, username, passwordHash: hash },
      });
      console.info(`[admin:credential] created "${username}" for ${admin.displayName}.`);
    } else {
      await client.consoleCredential.update({
        where: { username },
        data: { passwordHash: hash, failedAttempts: 0, lockedUntil: null },
      });
      console.info(`[admin:credential] reset "${username}" for ${admin.displayName}.`);
    }
    console.info('log in at the admin console with this username and password.');
  } finally {
    await client.$disconnect();
  }
}

void main();
