import { hmacHex } from '../../../common/security/hash';
import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import type {
  ObjectStorageGateway,
  SignedDownload,
  SignedUpload,
  UploadTargetInput,
} from '../domain/object-storage.gateway';

export interface MockObjectStorageOptions {
  environment: string;
  /** HMAC key for signed URLs. Required in production; see the module factory. */
  signingSecret: string;
  /** Public base the signed URLs point at. */
  baseUrl: string;
  uploadUrlTtlSeconds: number;
  /** Short-lived: document access must expire quickly (`specs/10`). */
  downloadUrlTtlSeconds: number;
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
export class MockObjectStorageGateway implements ObjectStorageGateway {
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
