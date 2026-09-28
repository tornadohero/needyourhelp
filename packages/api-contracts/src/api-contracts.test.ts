import { describe, expect, it } from 'vitest';

import { API_BASE, ENDPOINTS, IDEMPOTENCY_HEADER, REQUEST_ID_HEADER, apiPath } from './endpoints';
import {
  ERROR_CODES,
  HTTP_STATUS_BY_ERROR_CODE,
  INTERNAL_ERROR_CODE,
  type ErrorCode,
} from './error-codes';
import { errorEnvelope, successEnvelope } from './envelope';

describe('api contracts', () => {
  it('prefixes every path with the versioned base', () => {
    expect(API_BASE).toBe('/api/v1');
    expect(apiPath(ENDPOINTS.health)).toBe('/api/v1/health');
    expect(apiPath(ENDPOINTS.auth.wechatLogin)).toBe('/api/v1/auth/wechat/login');
  });

  it('declares the spec idempotency and correlation headers', () => {
    expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key');
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });

  it('keeps error codes unique and stable', () => {
    const values = Object.values(ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    expect(ERROR_CODES.ORDER_NOT_PAYABLE).toBe('ORDER_NOT_PAYABLE');
  });

  it('maps every spec error code to an http status', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code as ErrorCode]).toBeGreaterThanOrEqual(400);
    }
    expect(HTTP_STATUS_BY_ERROR_CODE.AUTH_REQUIRED).toBe(401);
    expect(HTTP_STATUS_BY_ERROR_CODE.RATE_LIMITED).toBe(429);
  });

  it('builds the success and error envelopes from tests/api-contract-examples.md', () => {
    expect(successEnvelope({ orderNo: 'MP202610010001' }, 'req_1')).toEqual({
      data: { orderNo: 'MP202610010001' },
      requestId: 'req_1',
    });
    expect(errorEnvelope(ERROR_CODES.PROVIDER_NOT_APPROVED, 'not available', 'req_2')).toEqual({
      error: { code: 'PROVIDER_NOT_APPROVED', message: 'not available' },
      requestId: 'req_2',
    });
    expect(INTERNAL_ERROR_CODE).toBe('INTERNAL_ERROR');
  });
});
