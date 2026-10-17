import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { Consent, ConsentType, GrantConsentInput } from '../domain/consent.model';
import type { ConsentRepository } from '../domain/consent.repository';

/** Prisma adapter for {@link ConsentRepository}. */
@Injectable()
export class PrismaConsentRepository implements ConsentRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findActive(userId: string, consentType: ConsentType): Promise<Consent | null> {
    const row = await this.prisma.consent.findFirst({
      where: { userId, consentType, granted: true, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    return row ? mapConsent(row) : null;
  }

  async listByUser(userId: string): Promise<Consent[]> {
    const rows = await this.prisma.consent.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
    });
    return rows.map(mapConsent);
  }

  async grant(input: GrantConsentInput): Promise<Consent> {
    const row = await this.prisma.consent.create({
      data: {
        userId: input.userId,
        consentType: input.consentType,
        policyVersion: input.policyVersion,
        granted: true,
        grantedAt: new Date(),
        evidenceRef: input.evidenceRef ?? null,
      },
    });
    return mapConsent(row);
  }

  async revokeActive(userId: string, consentType: ConsentType): Promise<Consent | null> {
    const active = await this.prisma.consent.findFirst({
      where: { userId, consentType, granted: true, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    if (!active) {
      return null;
    }

    const row = await this.prisma.consent.update({
      where: { id: active.id },
      data: { revokedAt: new Date() },
    });
    return mapConsent(row);
  }
}

type ConsentRow = {
  id: string;
  userId: string;
  consentType: ConsentType;
  policyVersion: string;
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
  evidenceRef: string | null;
};

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    userId: row.userId,
    consentType: row.consentType,
    policyVersion: row.policyVersion,
    granted: row.granted,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
    evidenceRef: row.evidenceRef,
  };
}
