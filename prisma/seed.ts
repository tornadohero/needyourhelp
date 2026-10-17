/**
 * `prisma db seed` entry point.
 *
 * The seed routine itself lives in `./seed-data.ts` so the integration tests can
 * execute the same code path without any CLI side effects.
 */
import { PrismaClient } from '@prisma/client';

import { seedDatabase } from './seed-data';

async function main(): Promise<void> {
  const client = new PrismaClient();
  try {
    const result = await seedDatabase(client);
    console.info(
      `[seed] users=${result.users.length} roles=${result.userRoles.length} ` +
        `featureFlags=${result.featureFlags.length} taxonomyTerms=${result.taxonomyTerms.length}`,
    );
  } finally {
    await client.$disconnect();
  }
}

void main();
