import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ServiceReadiness } from '../../provider/domain/provider-readiness.gates';

/**
 * "At least one published service": the last discovery gate of
 * `specs/01-business-rules.md` §Provider approval.
 *
 * The rule lives in the service context; the provider context only depends on
 * the {@link ServiceReadiness} port, so the two stay decoupled (same shape as
 * the verification gate, T006).
 */
@Injectable()
export class PrismaServiceReadiness implements ServiceReadiness {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async hasPublishedService(providerId: string): Promise<boolean> {
    const count = await this.prisma.service.count({
      where: { providerId, status: 'PUBLISHED' },
    });
    return count > 0;
  }
}
