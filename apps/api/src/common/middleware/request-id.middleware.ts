import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@mentor/api-contracts';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { setRequestId } from '../http/request-context';

const MAX_INCOMING_LENGTH = 128;

/**
 * Assigns a request id to every HTTP request and echoes it back.
 * Security spec §API: request IDs are required for log correlation.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header(REQUEST_ID_HEADER);
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= MAX_INCOMING_LENGTH
        ? incoming
        : randomUUID();
    setRequestId(request, requestId);
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
