import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Injectable, type NestInterceptor } from '@nestjs/common';
import { type ApiSuccessResponse, successEnvelope } from '@mentor/api-contracts';
import { type Observable, map } from 'rxjs';

import { getRequestId } from '../http/request-context';

/**
 * Wraps every successful payload in the API success envelope
 * (`tests/api-contract-examples.md`). Keeps response shaping out of controllers.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T>> {
    const requestId = getRequestId(context.switchToHttp().getRequest());
    return next.handle().pipe(map((data) => successEnvelope(data, requestId)));
  }
}
