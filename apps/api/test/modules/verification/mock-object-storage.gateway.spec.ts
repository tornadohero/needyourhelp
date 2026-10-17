import { describe, expect, it } from 'vitest';

import { MockObjectStorageGateway } from '../../../src/modules/verification/infrastructure/mock-object-storage.gateway';

function build(environment = 'test') {
  return new MockObjectStorageGateway({
    environment,
    signingSecret: 'spec-secret',
    baseUrl: 'https://storage.test/objects',
    uploadUrlTtlSeconds: 900,
    downloadUrlTtlSeconds: 300,
  });
}

describe('MockObjectStorageGateway', () => {
  it('signs an upload URL that expires', async () => {
    const gateway = build();

    const upload = await gateway.createUploadUrl({
      key: 'verification/case-1/doc-1',
      contentType: 'image/png',
      contentLength: 1024,
    });

    expect(upload.method).toBe('PUT');
    expect(upload.url).toContain('verification/case-1/doc-1');
    expect(upload.url).toMatch(/expires=\d+/);
    expect(upload.url).toMatch(/signature=[0-9a-f]{64}/);
    expect(upload.headers['content-type']).toBe('image/png');
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps download URLs short-lived and purpose-bound', async () => {
    const gateway = build();

    const download = await gateway.createDownloadUrl({ key: 'verification/case-1/doc-1' });
    const upload = await gateway.createUploadUrl({
      key: 'verification/case-1/doc-1',
      contentType: 'application/pdf',
      contentLength: 10,
    });

    // Same key, different purpose: the signatures must differ so an upload URL
    // cannot be replayed to read an object.
    expect(download.url).not.toBe(upload.url);
    expect(download.url).toMatch(/signature=[0-9a-f]{64}/);
    expect(download.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it('signs different keys differently', async () => {
    const gateway = build();

    const left = await gateway.createDownloadUrl({ key: 'a' });
    const right = await gateway.createDownloadUrl({ key: 'b' });

    expect(left.url).not.toBe(right.url);
  });

  it('refuses to run in production', async () => {
    const gateway = build('production');

    await expect(
      gateway.createUploadUrl({ key: 'k', contentType: 'image/png', contentLength: 1 }),
    ).rejects.toThrow(/isolated dev\/test environments/);

    await expect(gateway.createDownloadUrl({ key: 'k' })).rejects.toThrow(
      /isolated dev\/test environments/,
    );
  });
});
