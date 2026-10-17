import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global provider so repository adapters can inject `PrismaService` without
 * importing the module in every feature module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
