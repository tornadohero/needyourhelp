import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  INTERNAL_ERROR_CODE,
  REQUEST_ID_HEADER,
  type ErrorCode,
  errorEnvelope,
} from '@mentor/api-contracts';
import type { Request, Response } from 'express';

import { getRequestId } from '../http/request-context';

interface HttpExceptionPayload {
  code?: string;
  message?: string | string[];
}

const FALLBACK_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.AUTH_REQUIRED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

/**
 * Translates every thrown error into the API error envelope.
 * Unhandled errors are logged server-side and never leaked to the client
 * (security spec §Logging).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = getRequestId(request);

    response.setHeader(REQUEST_ID_HEADER, requestId);

    // Input size limit (`specs/13-security-spec.md` §API). The body parser is
    // what stops an oversized request, and it does so with an error that is not
    // an `HttpException`: answered here so the caller gets the envelope.
    if (this.isPayloadTooLarge(exception)) {
      response
        .status(413)
        .json(errorEnvelope(ERROR_CODES.VALIDATION_ERROR, 'Request body is too large.', requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse() as HttpExceptionPayload | string;
      const normalized = typeof payload === 'object' && payload !== null ? payload : {};
      const code = normalized.code ?? FALLBACK_BY_STATUS[status] ?? ERROR_CODES.VALIDATION_ERROR;
      const message = this.toMessage(normalized.message) ?? exception.message;
      response.status(status).json(errorEnvelope(code, message, requestId));
      return;
    }

    this.logger.error(
      `Unhandled error [requestId=${requestId}] ${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(errorEnvelope(INTERNAL_ERROR_CODE, 'Internal server error.', requestId));
  }

  private isPayloadTooLarge(exception: unknown): boolean {
    const candidate = exception as { type?: unknown; status?: unknown } | null;
    return candidate?.type === 'entity.too.large' || candidate?.status === 413;
  }

  private toMessage(message: string | string[] | undefined): string | undefined {
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return message;
  }
}
