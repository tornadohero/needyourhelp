import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthResponse } from '@mentor/api-contracts';

/**
 * Liveness/readiness probe. Intentionally exposes no infrastructure details.
 * Business modules are added by later tasks; this controller owns no domain logic.
 *
 * `ConfigService` is injected explicitly so the emitted decorator metadata keeps a
 * runtime reference instead of collapsing to `Object`.
 */
@Controller()
export class AppController {
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  @Get('health')
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      env: this.configService.get<string>('NODE_ENV') ?? 'local',
      time: new Date().toISOString(),
    };
  }
}
