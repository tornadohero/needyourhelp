import { constantTimeEqual, hmacHex } from '../../../common/security/hash';
import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import type { LocalObjectStore, PutSignedObjectInput, StoredObject } from '../domain/object-store';
import type {
  ObjectStorageGateway,
  SignedDownload,
  SignedUpload,
  UploadTargetInput,
} from '../domain/object-storage.gateway';
import {
  documentContentTypeRejected,
  documentTooLarge,
  signedUrlInvalid,
} from '../domain/verification.errors';
import {
  DEFAULT_DOCUMENT_MAX_BYTES,
  isAllowedDocumentContentType,
} from '../domain/verification-document-policy';

export interface MockObjectStorageOptions {
  environment: string;
  /** HMAC key for signed URLs. Required in production; see the module factory. */
  signingSecret: string;
  /** Public base the signed URLs point at. */
  baseUrl: string;
  uploadUrlTtlSeconds: number;
  /** Short-lived: document access must expire quickly (`specs/10`). */
  downloadUrlTtlSeconds: number;
  /** Document size ceiling enforced on upload (T028 gap G3). */
  maxBytes?: number;
}

/**
 * Mock `ObjectStorage` adapter for local development and tests
 * (`specs/03-architecture-spec.md` §External provider ports).
 *
 * It never touches a real bucket. URLs are HMAC-signed and expire:
 * - signatures bind the purpose (`upload` / `download`) and the object key, so a
 *   download URL cannot be replayed as an upload URL;
 * - the object key is always supplied by the server.
 *
 * It refuses to run in production: a mock bucket must not become the production
 * document store. A real private-bucket adapter is required before production
 * use (deployment/production-readiness work).
 */
export class MockObjectStorageGateway implements ObjectStorageGateway, LocalObjectStore {
  /** The local bucket. Never a production store: this adapter refuses to run there. */
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly options: MockObjectStorageOptions) {}

  async createUploadUrl(input: UploadTargetInput): Promise<SignedUpload> {
    this.assertAllowed();

    const expiresAt = new Date(Date.now() + this.options.uploadUrlTtlSeconds * 1000);
    return {
      url: this.signUrl('upload', input.key, expiresAt),
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresAt,
    };
  }

  async createDownloadUrl(input: { key: string }): Promise<SignedDownload> {
    this.assertAllowed();

    const expiresAt = new Date(Date.now() + this.options.downloadUrlTtlSeconds * 1000);
    return { url: this.signUrl('download', input.key, expiresAt), expiresAt };
  }

  /**
   * `PUT` half of a signed upload URL (T028 gap G3).
   *
   * The URL is the only credential, so it is verified exactly as it was signed:
   * purpose, key and expiry. Content type and size are checked before anything
   * is stored.
   */
  async putSigned(input: PutSignedObjectInput): Promise<void> {
    this.assertAllowed();
    this.assertSignature(input, 'upload');

    const contentType = (input.contentType ?? '').trim().toLowerCase();
    if (!isAllowedDocumentContentType(contentType)) {
      throw documentContentTypeRejected();
    }

    const bytes = input.bytes ?? Buffer.alloc(0);
    if (bytes.length === 0) {
      throw documentContentTypeRejected('The document is empty.');
    }
    if (bytes.length > (this.options.maxBytes ?? DEFAULT_DOCUMENT_MAX_BYTES)) {
      throw documentTooLarge();
    }

    this.objects.set(input.key, { bytes: Buffer.from(bytes), contentType });
  }

  /** `GET` half of a signed download URL (T028 gap G3). */
  async getSigned(input: PutSignedObjectInput): Promise<StoredObject | null> {
    this.assertAllowed();
    this.assertSignature(input, 'download');
    return this.objects.get(input.key) ?? null;
  }

  private assertSignature(input: PutSignedObjectInput, purpose: 'upload' | 'download'): void {
    if (input.purpose !== purpose) {
      // A download URL replayed as an upload (or the other way round) is refused.
      throw signedUrlInvalid();
    }
    if (!Number.isFinite(input.expires) || input.expires * 1000 <= Date.now()) {
      throw signedUrlInvalid('This object URL has expired.');
    }
    const expected = hmacHex(
      `${purpose}|${input.key}|${Math.floor(input.expires)}`,
      this.options.signingSecret,
    );
    if (!input.signature || !constantTimeEqual(input.signature, expected)) {
      throw signedUrlInvalid();
    }
  }

  private signUrl(purpose: 'upload' | 'download', key: string, expiresAt: Date): string {
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const signature = hmacHex(`${purpose}|${key}|${expires}`, this.options.signingSecret);
    const base = this.options.baseUrl.replace(/\/+$/, '');
    return `${base}/${key}?expires=${expires}&signature=${signature}`;
  }

  private assertAllowed(): void {
    if (!isMockAdapterAllowed(this.options.environment)) {
      throw new Error('Mock object storage is only available in isolated dev/test environments.');
    }
  }
}
