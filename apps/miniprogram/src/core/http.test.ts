import { describe, expect, it } from 'vitest';

import { ApiClient } from './http';
import type { Transport, TransportRequest } from './http';
import { ApiError, TransportError } from './envelope';

/** Records what the client asked for and answers from a queue. */
function recorder(responses: Array<{ status: number; body: unknown }>): {
  transport: Transport;
  calls: TransportRequest[];
} {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    calls.push(request);
    const next = responses.shift();
    if (!next) {
      throw new Error('no answer');
    }
    return next;
  };
  return { transport, calls };
}

describe('ApiClient', () => {
  it('calls /api/v1 with JSON, a request id and the bearer token', async () => {
    const { transport, calls } = recorder([{ status: 200, body: { data: { ok: true } } }]);
    const client = new ApiClient({
      origin: 'https://api.example.com/',
      transport,
      requestId: () => 'req-1',
    });

    await client.post('/orders', { body: { serviceId: 'svc-1' }, accessToken: 'token-1' });

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.headers.Authorization).toBe('Bearer token-1');
    expect(calls[0]?.headers['X-Request-Id']).toBe('req-1');
    expect(calls[0]?.body).toBe('{"serviceId":"svc-1"}');
  });

  it('sends no Content-Type and no body for a read', async () => {
    const { transport, calls } = recorder([{ status: 200, body: { data: {} } }]);
    const client = new ApiClient({ origin: 'https://api.example.com', transport });

    await client.get('/providers', { query: { city: 'BEIJING', page: 2 } });

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/providers?city=BEIJING&page=2');
    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
    expect(calls[0]?.body).toBeUndefined();
  });

  it('forwards an idempotency key for money operations', async () => {
    const { transport, calls } = recorder([{ status: 200, body: { data: {} } }]);
    const client = new ApiClient({ origin: 'https://api.example.com', transport });

    await client.post('/orders/1/refund-request', {
      body: { reason: '时间不合适' },
      idempotencyKey: 'key-1',
    });

    expect(calls[0]?.headers['Idempotency-Key']).toBe('key-1');
  });

  it('answers a failure with the contract code', async () => {
    const { transport } = recorder([
      { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } } },
    ]);
    const client = new ApiClient({ origin: 'https://api.example.com', transport });

    await expect(client.get('/providers')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('turns a dead network into a TransportError, keeping internals out', async () => {
    const { transport } = recorder([]);
    const client = new ApiClient({ origin: 'https://api.example.com', transport });

    await expect(client.get('/providers')).rejects.toBeInstanceOf(TransportError);
  });

  it('passes the configured timeout to the transport', async () => {
    const { transport, calls } = recorder([{ status: 200, body: { data: {} } }]);
    const client = new ApiClient({
      origin: 'https://api.example.com',
      transport,
      timeoutMs: 3_000,
    });

    await client.get('/me');

    expect(calls[0]?.timeoutMs).toBe(3_000);
  });

  it('propagates an ApiError instance so callers can branch on the code', async () => {
    const { transport } = recorder([
      { status: 403, body: { error: { code: 'CHILD_ACCESS_DENIED', message: 'no' } } },
    ]);
    const client = new ApiClient({ origin: 'https://api.example.com', transport });

    await expect(client.get('/me/children/1')).rejects.toBeInstanceOf(ApiError);
  });
});
