import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { ProviderModule } from '../provider/provider.module';
import { AvailabilityService } from './application/availability.service';
import { AVAILABILITY_SLOT_REPOSITORY } from './domain/availability-slot.repository';
import { AvailabilityController } from './http/availability.controller';
import { PrismaAvailabilitySlotRepository } from './infrastructure/prisma-availability-slot.repository';

/**
 * Availability context (`specs/02-domain-model.md` §Tutoring: Availability).
 *
 * It owns the slot table and the booking invariant; it never decides who is
 * discoverable (T010 does) and never decides whether an order may exist (T013
 * does). Booking (T013) only calls {@link AvailabilityService.claim}.
 */
@Module({
  imports: [AuthModule, ProviderModule, DiscoveryModule],
  controllers: [AvailabilityController],
  providers: [
    AvailabilityService,
    { provide: AVAILABILITY_SLOT_REPOSITORY, useClass: PrismaAvailabilitySlotRepository },
  ],
  exports: [AvailabilityService, AVAILABILITY_SLOT_REPOSITORY],
})
export class AvailabilityModule {}
