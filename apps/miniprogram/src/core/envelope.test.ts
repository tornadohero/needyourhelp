import { describe, expect, it } from 'vitest';

import { ApiError, TransportError, unwrap } from './envelope';

describe('unwrap', () => {
  it('returns the payload of a success envelope', () => {
    expect(unwrap<{ id: string }>(200, { data: { id: 'abc' }, requestId: 'r-1' })).toEqual({
      id: 'abc',
    });
    // A command answered with 200 is still a success, not a special case.
    expect(unwrap<{ ok: true }>(200, { data: { ok: true as const } })).toEqual({ ok: true });
  });

  it('raises an ApiError carrying the contract code', () => {
    try {
      unwrap(409, {
        error: { code: 'ORDER_INVALID_STATE', message: '状态已变化' },
        requestId: 'r-2',
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('ORDER_INVALID_STATE');
      expect(apiError.status).toBe(409);
      expect(apiError.requestId).toBe('r-2');
      expect(apiError.isUnauthorized).toBe(false);
    }
  });

  it('marks an expired session so the caller knows to refresh', () => {
    try {
      unwrap(401, { error: { code: 'AUTH_REQUIRED', message: 'nope' } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).isUnauthorized).toBe(true);
    }
  });

  it('treats an unexpected shape as a failure, never as data', () => {
    // A proxy error page or an empty body must not reach a screen as a payload.
    expect(() => unwrap(200, '<html>oops</html>')).toThrow(ApiError);
    expect(() => unwrap(200, {})).toThrow(ApiError);
    expect(() => unwrap(500, { error: {} })).toThrow(ApiError);
  });
});

describe('TransportError', () => {
  it('is distinct from an API refusal', () => {
    const error = new TransportError();
    expect(error).not.toBeInstanceOf(ApiError);
  });
});
