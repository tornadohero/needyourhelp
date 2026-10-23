import type { OnModuleDestroy } from '@nestjs/common';
import { Global, Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createRedisHandle } from './redis.client';
import type { RedisHandle } from './redis.client';

/** Injection token: the handle, never the raw client, so absence is explicit. */
export const REDIS = 'REDIS';

/**
 * Redis wiring (T034).
 *
 * One handle for the whole process. It is `@Global()` because rate limiting and
 * idempotency are cross-cutting: every module that needs shared state gets the
 * same decision — either there is a Redis, or there is not.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<RedisHandle> =>
        createRedisHandle(config.get<string>('REDIS_URL')),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: RedisHandle) {}

  /** A clean shutdown closes the connection instead of leaking it. */
  async onModuleDestroy(): Promise<void> {
    await this.redis.close();
  }
}
