import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import { describeVerificationCase } from '../core/provider-desk';
import type { VerificationRowView } from '../core/provider-desk';
import type {
  VerificationCaseResponse,
  VerificationDocumentTypeName,
  VerificationTypeName,
  VerificationUploadUrlResponse,
} from '@mentor/api-contracts';

/**
 * Verification use cases (T032) — `specs/11` §Provider pages：Identity /
 * Education verification (FE-41).
 *
 * The document itself never passes through the platform's JSON API: the server
 * signs a short-lived URL, the bytes go straight to the object store, and the
 * case is submitted afterwards (`specs/13-security-spec.md` §File upload).
 *
 * The client sends **no file hash**. A WeChat mini program cannot compute
 * SHA-256, so the platform records the hash from the bytes it receives — an
 * integrity record made by the server, not a claim made by the client.
 */

/** `POST /verification/cases`: start one. */
export async function createVerificationCase(
  context: MentorContext,
  verificationType: VerificationTypeName,
): Promise<VerificationRowView> {
  const created = await context.session.withSession((accessToken) =>
    context.client.post<VerificationCaseResponse>(ROUTES.verificationCases, {
      accessToken,
      body: { verificationType },
    }),
  );
  return describeVerificationCase(created);
}

export interface DocumentUploadTarget {
  documentId: string;
  /** Where the bytes go — the object store, not this API. */
  uploadUrl: string;
  /** Headers the signature came with; sending fewer is a refused upload. */
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * `POST /verification/cases/:id/documents/upload-url`.
 *
 * No `fileHash`: the server hashes what it receives.
 */
export async function requestDocumentUpload(
  context: MentorContext,
  caseId: string,
  document: {
    documentType: VerificationDocumentTypeName;
    contentType: string;
    byteSize: number;
  },
): Promise<DocumentUploadTarget> {
  const response = await context.session.withSession((accessToken) =>
    context.client.post<VerificationUploadUrlResponse>(
      fillPath(ROUTES.verificationCaseDocuments, { id: caseId }),
      { accessToken, body: document },
    ),
  );

  return {
    documentId: response.documentId,
    uploadUrl: response.uploadUrl,
    headers: response.headers,
    expiresAt: response.expiresAt,
  };
}

/** `POST /verification/cases/:id/submit`: hand the case to a reviewer (200). */
export async function submitVerificationCase(
  context: MentorContext,
  caseId: string,
): Promise<VerificationRowView> {
  const submitted = await context.session.withSession((accessToken) =>
    context.client.post<VerificationCaseResponse>(
      fillPath(ROUTES.verificationCaseSubmit, { id: caseId }),
      { accessToken },
    ),
  );
  return describeVerificationCase(submitted);
}

/**
 * The whole evidence step: start a case, upload one document, submit.
 *
 * `upload` is injected because it is the only part that is platform-specific
 * (`wx.request` with a binary body); everything else is the contract.
 */
export async function submitEvidence(
  context: MentorContext,
  options: {
    verificationType: VerificationTypeName;
    documentType: VerificationDocumentTypeName;
    contentType: string;
    byteSize: number;
    upload: (target: DocumentUploadTarget) => Promise<void>;
  },
): Promise<VerificationRowView> {
  const created = await createVerificationCase(context, options.verificationType);
  const target = await requestDocumentUpload(context, created.id, {
    documentType: options.documentType,
    contentType: options.contentType,
    byteSize: options.byteSize,
  });
  await options.upload(target);
  return submitVerificationCase(context, created.id);
}
