/**
 * The local half of a signed object URL (T028 gap G3).
 *
 * `specs/03` keeps object storage behind a port, and in production the client
 * uploads **straight to the bucket**: the API only ever hands out presigned URLs.
 * The mock adapter has no bucket to upload to, which is why the verification
 * flow could not be completed locally.
 *
 * This port closes that gap without changing the production shape: it is only
 * bound by the mock adapter, and it verifies the same HMAC the adapter signed
 * (purpose + key + expiry), so a download URL cannot be replayed as an upload
 * and an expired or tampered URL is refused. A real adapter simply never
 * implements it, and the route answers 404.
 */

/** Dependency-injection token for {@link LocalObjectStore}. */
export const LOCAL_OBJECT_STORE = 'LOCAL_OBJECT_STORE';

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface PutSignedObjectInput {
  purpose: 'upload' | 'download';
  /** Server-generated object key; the signature binds it. */
  key: string;
  /** Unix seconds, from the signed URL. */
  expires: number;
  signature: string;
  contentType?: string;
  bytes?: Buffer;
}

export interface LocalObjectStore {
  /** Throws when the signature, the purpose or the expiry does not hold. */
  putSigned(input: PutSignedObjectInput): Promise<void>;

  /** `null` when the object is not here; throws when the URL does not hold. */
  getSigned(input: PutSignedObjectInput): Promise<StoredObject | null>;
}
