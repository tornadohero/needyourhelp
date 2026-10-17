import { Inject, Injectable } from '@nestjs/common';

import { openJson, sealJson } from '../../../common/security/seal';
import type { DocumentMetadataCipher } from '../domain/document-metadata-cipher';

/** Dependency-injection token for the raw sealing key. */
export const DOCUMENT_METADATA_KEY = 'DOCUMENT_METADATA_KEY';

/**
 * AES-256-GCM adapter for {@link DocumentMetadataCipher}.
 *
 * Metadata is sealed before it is written to `verification_documents
 * .encrypted_metadata` (`specs/10-privacy-and-minors.md` §Verification
 * documents). The key comes from configuration, never from the data.
 */
@Injectable()
export class AesGcmDocumentMetadataCipher implements DocumentMetadataCipher {
  constructor(@Inject(DOCUMENT_METADATA_KEY) private readonly key: Buffer) {}

  seal(metadata: Record<string, unknown>): string {
    return sealJson(metadata, this.key);
  }

  open(sealed: string): Record<string, unknown> | null {
    return openJson<Record<string, unknown>>(sealed, this.key);
  }
}
