import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { VerificationReadiness } from '../../provider/domain/provider-readiness.gates';
import { isVerificationSatisfied } from '../domain/verification-policy';

/**
 * Verification gate for provider discoverability (`specs/01-business-rules.md`
 * §Provider approval: "required verification approved").
 *
 * The rule lives in the verification context; the provider context only depends
 * on the {@link VerificationReadiness} port, so the two stay decoupled.
 */
@Injectable()
export class PrismaVerificationReadiness implements VerificationReadiness {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async isSatisfied(providerId: string): Promise<boolean> {
    const approved = await this.prisma.verificationCase.findMany({
      where: { providerId, status: 'APPROVED' },
      select: { verificationType: true },
    });

    return isVerificationSatisfied(approved.map((row) => row.verificationType));
  }
}
