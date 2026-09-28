import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';

function createContext(requestId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ requestId }) }),
  } as unknown as ExecutionContext;
}

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps payloads in the spec success envelope', async () => {
    const handler: CallHandler<{ status: string }> = { handle: () => of({ status: 'ok' }) };

    const result = await firstValueFrom(
      new ResponseEnvelopeInterceptor<{ status: string }>().intercept(
        createContext('req_1'),
        handler,
      ),
    );

    expect(result).toEqual({ data: { status: 'ok' }, requestId: 'req_1' });
  });
});
