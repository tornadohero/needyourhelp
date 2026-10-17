/**
 * Encryption at rest for verification-document metadata.
 *
 * `specs/10-privacy-and-minors.md` §Verification documents: "encrypted
 * metadata". The blob may contain client-supplied values (original file name),
 * so it is authenticated-encrypted before it reaches the database.
 */

/** Dependency-injection token for {@link DocumentMetadataCipher}. */
export const DOCUMENT_METADATA_CIPHER = 'DOCUMENT_METADATA_CIPHER';

export interface DocumentMetadataCipher {
  seal(metadata: Record<string, unknown>): string;

  /** `null` when the blob was tampered with or sealed with another key. */
  open(sealed: string): Record<string, unknown> | null;
}
