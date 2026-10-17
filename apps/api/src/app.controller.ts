import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { HealthResponse, ReadinessResponse } from '@mentor/api-contracts';

import { RateLimit } from './common/security/rate-limit.interceptor';
import { PrismaService } from './infrastructure/prisma/prisma.service';

/**
 * Liveness and readiness probes. Intentionally expose no infrastructure details.
 * Business modules are added by later tasks; this controller owns no domain logic.
 *
 * `ConfigService` is injected explicitly so the emitted decorator metadata keeps a
 * runtime reference instead of collapsing to `Object`.
 */
@Controller()
export class AppController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** `GET /health`: liveness. The process answers, nothing else is claimed. */
  @Get('health')
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      env: this.env(),
      time: new Date().toISOString(),
    };
  }

  /**
   * `GET /health/ready`: readiness (T024: monitoring).
   *
   * A probe that only answers "the process is up" hides the failure operators
   * actually need: an API that is up but cannot reach its database. This one
   * asks the database, so a load balancer can stop sending traffic — and an
   * alert can fire — before users see errors.
   */
  @Get('health/ready')
  // A probe must never be throttled into a false alarm by its own request rate.
  @RateLimit('health.probe')
  async ready(): Promise<ReadinessResponse> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        service: 'api',
        database: 'up',
        databaseLatencyMs: Date.now() - startedAt,
        env: this.env(),
        time: new Date().toISOString(),
      };
    } catch {
      // One bit of information, and 503 so the probe fails closed.
      throw new ServiceUnavailableException('The database is not reachable.');
    }
  }

  private env(): string {
    return this.configService.get<string>('NODE_ENV') ?? 'local';
  }
}
