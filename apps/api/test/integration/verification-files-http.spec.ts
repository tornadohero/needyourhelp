import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { OBJECT_STORAGE_GATEWAY } from '../../src/modules/verification/domain/object-storage.gateway';
import { LOCAL_OBJECT_STORE } from '../../src/modules/verification/domain/object-store';
import { VERIFICATION_CASE_REPOSITORY } from '../../src/modules/verification/domain/verification-case.repository';
import { VERIFICATION_DOCUMENT_MAX_BYTES } from '../../src/modules/verification/domain/verification-document-policy';
import { PrismaVerificationCaseRepository } from '../../src/modules/verification/infrastructure/prisma-verification-case.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { FilesController } from '../../src/modules/verification/http/files.controller';
import { MockObjectStorageGateway } from '../../src/modules/verification/infrastructure/mock-object-storage.gateway';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * The signed object URL round trip over HTTP (T028 gap G3).
 *
 * Before this route existed, `POST /verification/cases/:id/documents/upload-url`
 * handed out a URL that nothing served, so the verification flow could not be
 * completed locally. This test drives the whole loop with the real adapter:
 * sign a URL, `PUT` the bytes, `GET` them back, and prove that a tampered or
 * unknown URL is refused.
 */
describeWithDatabase('verification document object URLs', () => {
  const prisma = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  let storage: MockObjectStorageGateway;

  beforeAll(async () => {
    await prisma.$connect();
    storage = new MockObjectStorageGateway({
      environment: 'test',
      signingSecret: 'files-integration-secret',
      // The host is rewritten in the test: what matters is the signed path.
      baseUrl: 'https://storage.test/objects',
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 300,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: OBJECT_STORAGE_GATEWAY, useValue: storage },
        { provide: LOCAL_OBJECT_STORE, useExisting: OBJECT_STORAGE_GATEWAY },
        { provide: VERIFICATION_DOCUMENT_MAX_BYTES, useValue: 10 * 1024 * 1024 },
        // The controller records the hash of the bytes it receives.
        { provide: VERIFICATION_CASE_REPOSITORY, useClass: PrismaVerificationCaseRepository },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${API_BASE}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  /** Point a signed storage URL at the test server, keeping path and signature. */
  function local(url: string): string {
    const parsed = new URL(url);
    // `/objects` is the stand-in for the configured storage base; the platform's
    // own base ends with `/files`, which is where the route lives.
    return `${baseUrl}/files${parsed.pathname.replace(/^\/objects/, '')}?${parsed.searchParams.toString()}`;
  }

  it('completes the upload the platform signed and serves it back', async () => {
    const key = 'verification/case-integration/document-integration';
    const bytes = Buffer.from([8, 7, 6, 5, 4]);

    const upload = await storage.createUploadUrl({
      key,
      contentType: 'image/png',
      contentLength: bytes.length,
    });

    const put = await fetch(local(upload.url), {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    expect(put.status).toBe(200);
    const stored = (await put.json()) as { data: { key: string; byteSize: number } };
    expect(stored.data).toMatchObject({ key, byteSize: bytes.length });

    const download = await storage.createDownloadUrl({ key });
    const get = await fetch(local(download.url));
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    // A private document is never cached by a shared proxy.
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes);
  });

  it('refuses a tampered URL and an unknown object', async () => {
    const key = 'verification/case-integration/other-document';
    const upload = await storage.createUploadUrl({
      key,
      contentType: 'image/jpeg',
      contentLength: 3,
    });

    const tampered = await fetch(`${local(upload.url).split('signature=')[0]}signature=deadbeef`, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.from([1, 2, 3]),
    });
    expect(tampered.status).toBe(403);
    expect(((await tampered.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    const download = await storage.createDownloadUrl({
      key: 'verification/case-integration/absent',
    });
    const missing = await fetch(local(download.url));
    expect(missing.status).toBe(404);
  });
});
