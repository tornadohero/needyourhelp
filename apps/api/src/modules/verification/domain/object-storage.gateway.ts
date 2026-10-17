/**
 * Private object storage port.
 *
 * `specs/03-architecture-spec.md` §External provider ports:
 *
 * ```ts
 * interface ObjectStorage {
 *   createUploadUrl(input): Promise<SignedUpload>;
 *   createDownloadUrl(input): Promise<SignedDownload>;
 * }
 * ```
 *
 * Verification documents live in a private bucket: the object key is generated
 * by the server and access is only ever granted through short-lived signed URLs
 * (`specs/10-privacy-and-minors.md` §Verification documents,
 * `specs/13-security-spec.md` §File upload).
 */

/** Dependency-injection token for {@link ObjectStorageGateway}. */
export const OBJECT_STORAGE_GATEWAY = 'OBJECT_STORAGE_GATEWAY';

export interface UploadTargetInput {
  /** Server-generated object key; never supplied by a client. */
  key: string;
  contentType: string;
  contentLength: number;
}

export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send (e.g. `content-type`). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface SignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ObjectStorageGateway {
  createUploadUrl(input: UploadTargetInput): Promise<SignedUpload>;
  createDownloadUrl(input: { key: string }): Promise<SignedDownload>;
}
