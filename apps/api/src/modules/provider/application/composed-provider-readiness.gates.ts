import { Inject, Injectable } from '@nestjs/common';

import type { ProviderReadinessGates } from '../domain/provider-readiness.gates';
import {
  SERVICE_READINESS,
  VERIFICATION_READINESS,
  type ServiceReadiness,
  type VerificationReadiness,
} from '../domain/provider-readiness.gates';

/**
 * Discovery gates composed from the contexts that own them.
 *
 * Keeping the two ports separate is what lets T006 (verification) and T009
 * (services) replace their adapter without touching the provider context.
 */
@Injectable()
export class ComposedProviderReadinessGates implements ProviderReadinessGates {
  constructor(
    @Inject(VERIFICATION_READINESS) private readonly verification: VerificationReadiness,
    @Inject(SERVICE_READINESS) private readonly services: ServiceReadiness,
  ) {}

  verificationSatisfied(providerId: string): Promise<boolean> {
    return this.verification.isSatisfied(providerId);
  }

  hasPublishedService(providerId: string): Promise<boolean> {
    return this.services.hasPublishedService(providerId);
  }
}
