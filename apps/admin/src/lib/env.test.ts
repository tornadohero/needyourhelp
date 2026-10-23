import { describe, expect, it } from 'vitest';

import { DEFAULT_API_BASE_URL, isTrustedApiBaseUrl, resolveApiBaseUrl } from './env';

describe('admin env', () => {
  it('has exactly one setting: where the API is', () => {
    expect(resolveApiBaseUrl(' https://api.example.com/ ')).toBe('https://api.example.com');
    expect(resolveApiBaseUrl('')).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
  });

  it('recognises the transports the console may talk over', () => {
    expect(isTrustedApiBaseUrl('https://api.example.com')).toBe(true);
    expect(isTrustedApiBaseUrl('http://localhost:3000')).toBe(true);
    expect(isTrustedApiBaseUrl('http://10.0.0.5:3000')).toBe(false);
  });
});
