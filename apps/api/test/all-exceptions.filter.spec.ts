import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_CODES, INTERNAL_ERROR_CODE, REQUEST_ID_HEADER } from '@mentor/api-contracts';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

interface Harness {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
}

function createHost(requestId: string): Harness {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId }),
      getResponse: () => ({ status, setHeader }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps http exceptions to the spec error envelope and echoes the request id', () => {
    const { host, status, json, setHeader } = createHost('req_1');

    filter.catch(new NotFoundException('Missing'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Missing' },
      requestId: 'req_1',
    });
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'req_1');
  });

  it('honours an explicit domain code carried by the exception', () => {
    const { host, json } = createHost('req_2');

    filter.catch(
      new HttpException(
        { code: ERROR_CODES.PROVIDER_NOT_APPROVED, message: 'Provider unavailable' },
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      error: { code: 'PROVIDER_NOT_APPROVED', message: 'Provider unavailable' },
      requestId: 'req_2',
    });
  });

  it('never leaks internal error details', () => {
    const { host, status, json } = createHost('req_3');
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    filter.catch(new Error('connection string: postgres://user:secret@host'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = json.mock.calls[0]?.[0] as { error: { code: string; message: string } };
    expect(payload.error.code).toBe(INTERNAL_ERROR_CODE);
    expect(payload.error.message).toBe('Internal server error.');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
