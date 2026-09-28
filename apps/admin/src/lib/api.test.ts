import { describe, expect, it } from 'vitest';

import { healthEndpointUrl, resolveApiBaseUrl } from './api';

describe('admin api helpers', () => {
  it('resolves the configured api base url with a safe default', () => {
    expect(resolveApiBaseUrl()).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
  });

  it('builds the versioned health endpoint url', () => {
    expect(healthEndpointUrl('http://localhost:3000')).toBe('http://localhost:3000/api/v1/health');
    expect(healthEndpointUrl('http://localhost:3000/')).toBe('http://localhost:3000/api/v1/health');
  });
});
