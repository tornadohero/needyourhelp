import type { Request, Response } from 'express';
import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { LOCAL_OBJECT_STORE } from '../domain/object-store';
import type { LocalObjectStore } from '../domain/object-store';
import {
  DEFAULT_DOCUMENT_MAX_BYTES,
  VERIFICATION_DOCUMENT_MAX_BYTES,
} from '../domain/verification-document-policy';
import { documentTooLarge, verificationNotFound } from '../domain/verification.errors';
import { throwAsHttpError } from './verification-error-translator';

/**
 * The local endpoint behind the mock object storage's signed URLs (T028 gap G3).
 *
 * In production the client uploads straight to the private bucket and this route
 * is never bound: the URL host is the bucket's, not ours. Locally there is no
 * bucket, so this controller is the bucket — with the same rules:
 *
 * - the **signature is the credential**: no session, no role, no body field
 *   decides access. It binds purpose + object key + expiry, so an expired,
 *   tampered or replayed URL is refused;
 * - the object key comes from the path the server itself signed, never chosen by
 *   the client;
 * - the declared size is checked before a byte is read, and the read itself is
 *   capped (`specs/13-security-spec.md` §API: input size limits);
 * - downloads are served `no-store`: a private document is never cached.
 */
@Controller('files')
export class FilesController {
  constructor(
    @Inject(LOCAL_OBJECT_STORE) private readonly store: LocalObjectStore | undefined,
    @Optional()
    @Inject(VERIFICATION_DOCUMENT_MAX_BYTES)
    private readonly maxBytes?: number,
  ) {}

  /** `PUT /files/verification/:caseId/:documentId?expires=&signature=`. */
  @Put('verification/:caseId/:documentId')
  @HttpCode(200)
  async upload(
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Req() request: Request,
  ): Promise<{ key: string; byteSize: number; contentType: string }> {
    return this.run(async () => {
      this.requireStore();
      const limit = this.maxBytes ?? DEFAULT_DOCUMENT_MAX_BYTES;

      // Cheap guard first: an oversized request costs a header and nothing else.
      const declared = Number(request.header('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > limit) {
        throw documentTooLarge();
      }

      const bytes = await readBody(request, limit);
      const contentType = (request.header('content-type') ?? '').split(';')[0] ?? '';

      await this.store!.putSigned({
        purpose: 'upload',
        key: objectKey(caseId, documentId),
        expires: Number(expires),
        signature: signature ?? '',
        contentType,
        bytes,
      });

      return { key: objectKey(caseId, documentId), byteSize: bytes.length, contentType };
    });
  }

  /** `GET /files/verification/:caseId/:documentId?expires=&signature=`. */
  @Get('verification/:caseId/:documentId')
  async download(
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.run(async () => {
      this.requireStore();

      const object = await this.store!.getSigned({
        purpose: 'download',
        key: objectKey(caseId, documentId),
        expires: Number(expires),
        signature: signature ?? '',
      });

      if (!object) {
        throw verificationNotFound('Document not found.');
      }

      response
        .status(200)
        .setHeader('content-type', object.contentType)
        .setHeader('content-length', String(object.bytes.length))
        // A private document is never stored by a shared cache.
        .setHeader('cache-control', 'no-store')
        .setHeader('x-content-type-options', 'nosniff')
        .end(object.bytes);
    });
  }

  /**
   * Without a local store the platform is pointing at a real bucket and this
   * route must not exist: `NOT_FOUND`, so the shape of the API does not change
   * between environments.
   */
  private requireStore(): void {
    if (!this.store) {
      throw verificationNotFound('No local object store is configured.');
    }
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throwAsHttpError(error);
    }
  }
}

function objectKey(caseId: string, documentId: string): string {
  return `verification/${caseId}/${documentId}`;
}

/**
 * The exact bytes the client sent, never a decoded copy.
 *
 * Nest's `rawBody` option only covers the JSON and urlencoded parsers, so a
 * binary upload arrives as an unconsumed stream: the bytes are read here, with a
 * hard cap so an oversized body cannot grow the process.
 */
async function readBody(request: Request, limit: number): Promise<Buffer> {
  const raw = (request as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (request.readableEnded) {
    return Buffer.alloc(0);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(documentTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
