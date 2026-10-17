import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpException, Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ERROR_CODES } from '@mentor/api-contracts';

import { RATE_LIMITER } from './rate-limit.model';
import type { RateLimitPolicy, RateLimiter } from './rate-limit.model';
import { policyFor } from './rate-limit.model';
import { readPrincipal } from '../../modules/auth/http/decorators/current-user.decorator';
import { hashRequestIp } from '../http/request-ip';

/** Metadata key set by {@link RateLimit}. */
export const RATE_LIMIT_METADATA = 'security:rate-limit';

/**
 * Declare the rate-limit policy of a route.
 *
 * A route that costs money, reputation or an identity document declares a named
 * policy; everything else falls back to the per-address default.
 */
export const RateLimit = (policy: string): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_METADATA, policy);

/**
 * Applies the declared policy before the route runs
 * (`specs/13-security-spec.md` §API: rate limiting).
 *
 * It runs as an interceptor, after authentication, so an account-scoped policy
 * counts a real account and not an address that happens to be shared.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly reflector: Reflector;

  constructor(
    @Optional() @Inject(RATE_LIMITER) private readonly limiter?: RateLimiter,
    @Optional() reflector?: Reflector,
  ) {
    // `Reflector` is stateless; falling back to a local one keeps the
    // interceptor working however it is constructed (also in tests that build
    // an application without the core module in scope).
    this.reflector = reflector ?? new Reflector();
  }

  async intercept(context: ExecutionContext, next: CallHandler) {
    // Disabled (no limiter bound): tests and embeddings opt out explicitly.
    if (!this.limiter) {
      return next.handle();
    }

    const policyName =
      this.reflector.get<string>(RATE_LIMIT_METADATA, context.getHandler()) ??
      this.reflector.get<string>(RATE_LIMIT_METADATA, context.getClass()) ??
      'default';
    const policy: RateLimitPolicy = policyFor(policyName);

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.keyFor(request, policy, policyName);
    const decision = await this.limiter.consume(key, policy);

    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string | number): void;
    }>();
    response.setHeader('RateLimit-Limit', decision.limit);
    response.setHeader('RateLimit-Remaining', decision.remaining);

    if (!decision.allowed) {
      response.setHeader('Retry-After', decision.retryAfterSeconds);
      throw new HttpException(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: 'Too many requests. Please slow down and try again later.',
        },
        429,
      );
    }

    return next.handle();
  }

  private keyFor(request: Request, policy: RateLimitPolicy, policyName: string): string {
    // Accounts are counted by id; anonymous callers by a hash of the address,
    // the same way an IP is hashed for the audit log (`AGENTS.md` §9).
    if (policy.scope === 'account') {
      const userId = readPrincipal(request)?.userId;
      if (userId) {
        return `${policyName}:account:${userId}`;
      }
      return `${policyName}:ip:${hashRequestIp(request) ?? 'unknown'}`;
    }
    return `${policyName}:ip:${hashRequestIp(request) ?? 'unknown'}`;
  }
}
