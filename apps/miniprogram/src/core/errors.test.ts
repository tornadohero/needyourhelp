import { describe, expect, it } from 'vitest';

import { ERROR_CODES, actionFor, errorMessageOf, messageFor } from './errors';
import { ApiError, TransportError } from './envelope';

describe('error mapping', () => {
  it('has a message and an action for every code the platform emits', () => {
    for (const code of ERROR_CODES) {
      expect(messageFor(code).length).toBeGreaterThan(0);
      expect(actionFor(code)).toBeTruthy();
    }
  });

  it('maps the codes a screen must handle differently', () => {
    // 401 is the only code worth a silent refresh; everything else surfaces.
    expect(actionFor('AUTH_REQUIRED')).toBe('relogin');
    expect(actionFor('FORBIDDEN')).toBe('forbidden');
    expect(actionFor('NOT_FOUND')).toBe('notfound');
    expect(actionFor('VALIDATION_ERROR')).toBe('form');
    expect(actionFor('ORDER_INVALID_STATE')).toBe('conflict');
    expect(actionFor('RATE_LIMITED')).toBe('retry');
    expect(actionFor('CHILD_ACCESS_DENIED')).toBe('forbidden');
  });

  it('answers unknown codes generically instead of echoing the server', () => {
    expect(messageFor('SOMETHING_NEW')).toBe(messageFor('INTERNAL_ERROR'));
    expect(actionFor('SOMETHING_NEW')).toBe('unexpected');
  });

  it('turns a thrown error into a screen message', () => {
    expect(errorMessageOf(new ApiError('REVIEW_NOT_ELIGIBLE', 409, 'x'))).toBe(
      messageFor('REVIEW_NOT_ELIGIBLE'),
    );
    expect(errorMessageOf(new TransportError())).toBe(messageFor('TRANSPORT_ERROR'));
    // An unknown object must not crash a screen.
    expect(errorMessageOf(new Error('boom'))).toBe(messageFor('TRANSPORT_ERROR'));
  });
});
