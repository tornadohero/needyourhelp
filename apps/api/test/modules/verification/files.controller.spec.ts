import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { FilesController } from '../../../src/modules/verification/http/files.controller';
import { MockObjectStorageGateway } from '../../../src/modules/verification/infrastructure/mock-object-storage.gateway';
import { Reflector } from '@nestjs/core';
import { VerificationModule } from '../../../src/modules/verification/verification.module';

const SECRET = 'unit-object-secret';

function gateway(maxBytes = 1_024) {
  return new MockObjectStorageGateway({
    environment: 'test',
    signingSecret: SECRET,
    baseUrl: 'https://storage.test/objects',
    uploadUrlTtlSeconds: 900,
    downloadUrlTtlSeconds: 300,
    maxBytes,
  });
}

function queryOf(url: string): { expires: string; signature: string } {
  const parsed = new URL(url);
  return {
    expires: parsed.searchParams.get('expires') ?? '',
    signature: parsed.searchParams.get('signature') ?? '',
  };
}

function requestWith(bytes: Buffer, contentType: string): Request {
  return {
    rawBody: bytes,
    header: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : undefined),
  } as unknown as Request;
}

/** Records what the controller would send instead of writing to a socket. */
function responseRecorder(): {
  response: Response;
  sent: { bytes?: Buffer };
  record: { statusCode: number; headers: Map<string, string> };
} {
  const sent: { bytes?: Buffer } = {};
  const record = { statusCode: 0, headers: new Map<string, string>() };

  const response = {
    status(code: number) {
      record.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      record.headers.set(name.toLowerCase(), value);
      return this;
    },
    end(bytes?: Buffer) {
      sent.bytes = bytes;
      return this;
    },
  } as unknown as Response;

  return { response, sent, record };
}

describe('FilesController', () => {
  it('stores and serves the exact bytes of a signed upload', async () => {
    const storage = gateway();
    const controller = new FilesController(storage);

    const upload = await storage.createUploadUrl({
      key: 'verification/case-1/doc-1',
      contentType: 'image/png',
      contentLength: 5,
    });
    const { expires, signature } = queryOf(upload.url);

    const stored = await controller.upload(
      'case-1',
      'doc-1',
      expires,
      signature,
      requestWith(Buffer.from([1, 2, 3, 4, 5]), 'image/png'),
    );
    expect(stored).toMatchObject({ key: 'verification/case-1/doc-1', byteSize: 5 });
    // The stored content type is the one the server signed, not a free choice.
    expect(stored.contentType).toBe('image/png');

    const download = await storage.createDownloadUrl({ key: 'verification/case-1/doc-1' });
    const { response, sent, record } = responseRecorder();
    await controller.download(
      'case-1',
      'doc-1',
      queryOf(download.url).expires,
      queryOf(download.url).signature,
      response,
    );

    expect(sent.bytes).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(record.headers.get('cache-control')).toBe('no-store');
    expect(record.headers.get('content-type')).toBe('image/png');
    expect(record.statusCode).toBe(200);
  });

  it('refuses a tampered, expired or replayed URL', async () => {
    const storage = gateway();
    const controller = new FilesController(storage);
    const upload = await storage.createUploadUrl({
      key: 'verification/case-2/doc-2',
      contentType: 'image/jpeg',
      contentLength: 3,
    });
    const { expires } = queryOf(upload.url);

    // Tampered signature.
    await expect(
      controller.upload(
        'case-2',
        'doc-2',
        expires,
        'deadbeef',
        requestWith(Buffer.from([1]), 'image/jpeg'),
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Expired.
    await expect(
      controller.upload(
        'case-2',
        'doc-2',
        '1',
        queryOf(upload.url).signature,
        requestWith(Buffer.from([1]), 'image/jpeg'),
      ),
    ).rejects.toMatchObject({ status: 403 });

    // A download URL replayed as an upload: the purpose is part of the signature.
    const download = await storage.createDownloadUrl({ key: 'verification/case-2/doc-2' });
    await expect(
      controller.upload(
        'case-2',
        'doc-2',
        queryOf(download.url).expires,
        queryOf(download.url).signature,
        requestWith(Buffer.from([1]), 'image/jpeg'),
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Another object's URL cannot be used for this key.
    const other = await storage.createUploadUrl({
      key: 'verification/case-2/other',
      contentType: 'image/jpeg',
      contentLength: 3,
    });
    await expect(
      controller.upload(
        'case-2',
        'doc-2',
        queryOf(other.url).expires,
        queryOf(other.url).signature,
        requestWith(Buffer.from([1]), 'image/jpeg'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('enforces the content-type whitelist and the size ceiling', async () => {
    const storage = gateway(8);
    const controller = new FilesController(storage);

    const html = await storage.createUploadUrl({
      key: 'verification/case-3/doc-3',
      contentType: 'text/html',
      contentLength: 4,
    });
    await expect(
      controller.upload(
        'case-3',
        'doc-3',
        queryOf(html.url).expires,
        queryOf(html.url).signature,
        requestWith(Buffer.from('<html>'), 'text/html'),
      ),
    ).rejects.toMatchObject({ status: 415 });

    const png = await storage.createUploadUrl({
      key: 'verification/case-3/doc-3',
      contentType: 'image/png',
      contentLength: 64,
    });
    await expect(
      controller.upload(
        'case-3',
        'doc-3',
        queryOf(png.url).expires,
        queryOf(png.url).signature,
        requestWith(Buffer.alloc(64), 'image/png'),
      ),
    ).rejects.toMatchObject({ status: 413 });

    // An empty upload is not a document.
    const empty = await storage.createUploadUrl({
      key: 'verification/case-3/doc-3',
      contentType: 'image/png',
      contentLength: 0,
    });
    await expect(
      controller.upload(
        'case-3',
        'doc-3',
        queryOf(empty.url).expires,
        queryOf(empty.url).signature,
        requestWith(Buffer.alloc(0), 'image/png'),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('answers 404 when no local store is bound (a real bucket is in use)', async () => {
    const controller = new FilesController(undefined);

    await expect(
      controller.upload(
        'case-4',
        'doc-4',
        '9999999999',
        'signature',
        requestWith(Buffer.from([1]), 'image/png'),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const { response } = responseRecorder();
    await expect(
      controller.download('case-4', 'doc-4', '9999999999', 'signature', response),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('is registered by the verification module', () => {
    const controllers = new Reflector().get('controllers', VerificationModule) ?? [];
    expect(controllers ?? []).toContain(FilesController);
  });
});
