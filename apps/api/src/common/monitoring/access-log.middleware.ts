import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getRequestId } from '../http/request-context';
import { hashRequestIp } from '../http/request-ip';

/**
 * Whether a path is a liveness/readiness probe.
 *
 * Probes are the noisiest traffic on the platform and the least informative, so
 * they are not logged. The API prefix is stripped first: middleware sees the
 * prefixed path (`/api/v1/health`), not the route it was declared with.
 */
function isProbePath(path: string): boolean {
  const withoutBase = path.replace(/^\/api\/v\d+/, '');
  return withoutBase === '/health' || withoutBase.startsWith('/health/');
}

/**
 * One structured line per request (`specs/03-architecture-spec.md`: structured
 * logs; T024: monitoring).
 *
 * The line is deliberately a whitelist: method, route path, status, duration,
 * request id and a **hash** of the caller address. The query string is dropped
 * because private-object URLs carry signatures and search URLs carry PII, and
 * no header, cookie or body field is ever written — `specs/13` forbids logging
 * tokens, and a log is not a place to keep them.
 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('access');

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const path = (request.originalUrl ?? request.url ?? '').split('?')[0] ?? '';
      if (isProbePath(path)) {
        return;
      }

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.log(
        JSON.stringify({
          kind: 'access',
          requestId: getRequestId(request),
          method: request.method,
          // Pathname only: query strings hold signatures and search terms.
          path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          // Hashed, like an audit row: the log must not hold a raw address.
          ipHash: hashRequestIp(request),
        }),
      );
    });

    next();
  }
}
