import type { NestMiddleware } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ERROR_CODES } from '@mentor/api-contracts';

import { getRequestId } from '../http/request-context';

/** Dependency-injection token for the configured maximum request body. */
export const REQUEST_BODY_MAX_BYTES = 'REQUEST_BODY_MAX_BYTES';

/**
 * 64 KiB: every JSON payload the platform accepts is far smaller (a report
 * description is 2 KiB), and documents never go through this API — they are
 * uploaded straight to object storage with a signed URL.
 */
export const DEFAULT_REQUEST_BODY_MAX_BYTES = 64 * 1_024;

/**
 * Input size limit (`specs/13-security-spec.md` §API: "input/output size
 * limits").
 *
 * The check runs on `content-length` before the body is parsed, so an oversized
 * request costs the process a header and nothing else.
 */
@Injectable()
export class RequestSizeLimitMiddleware implements NestMiddleware {
  constructor(@Optional() @Inject(REQUEST_BODY_MAX_BYTES) private readonly maxBytes?: number) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const limit = this.maxBytes ?? DEFAULT_REQUEST_BODY_MAX_BYTES;
    const declared = Number(request.header('content-length') ?? '0');

    if (Number.isFinite(declared) && declared > limit) {
      // Answered here rather than thrown: an exception raised in a middleware
      // never reaches the Nest filter, so it would surface as a 500.
      response.status(413).json({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Request body is too large.' },
        requestId: getRequestId(request),
      });
      return;
    }

    next();
  }
}
