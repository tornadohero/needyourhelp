import { describe, expect, it } from 'vitest';

import { ConfigurationError, resolveApiOrigin } from './env';

describe('resolveApiOrigin', () => {
  it('falls back to localhost while developing', () => {
    expect(resolveApiOrigin({ env: 'develop' })).toBe('http://localhost:3000');
  });

  it('uses the configured origin and trims trailing slashes', () => {
    expect(resolveApiOrigin({ configured: 'https://api.example.com///', env: 'release' })).toBe(
      'https://api.example.com',
    );
  });

  it('refuses to guess an origin outside development', () => {
    expect(() => resolveApiOrigin({ env: 'trial' })).toThrow(ConfigurationError);
    expect(() => resolveApiOrigin({ env: 'release' })).toThrow(ConfigurationError);
  });

  it('refuses a plain HTTP origin outside development', () => {
    // A client that talks to the wrong server is a security problem, not a warning.
    expect(() =>
      resolveApiOrigin({ configured: 'http://api.example.com', env: 'release' }),
    ).toThrow(ConfigurationError);
  });
});
