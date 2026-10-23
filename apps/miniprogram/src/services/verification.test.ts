import type {
  VerificationCaseResponse,
  VerificationUploadUrlResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import { MemoryTokenStore, SessionManager } from '../core/session';
import {
  createVerificationCase,
  requestDocumentUpload,
  submitEvidence,
  submitVerificationCase,
} from './verification';

type Answer = { status: number; body: unknown };

function harness(answers: Answer[] = []) {
  const calls: TransportRequest[] = [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({ client, store });
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 4_102_444_800 });

  return { context: { client, session }, calls };
}

function caseOf(overrides: Partial<VerificationCaseResponse> = {}): VerificationCaseResponse {
  return {
    id: 'case-1',
    providerId: 'provider-1',
    verificationType: 'IDENTITY',
    status: 'DRAFT',
    submittedAt: null,
    reviewedAt: null,
    decisionReason: null,
    documents: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function uploadTarget(): VerificationUploadUrlResponse {
  return {
    documentId: 'doc-1',
    documentType: 'ID_CARD',
    uploadUrl: 'https://objects.example.com/verification/case-1/doc-1?signature=abc',
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    expiresAt: '2026-10-21T02:05:00.000Z',
  };
}

describe('createVerificationCase', () => {
  it('starts a case with just its type', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: caseOf() } }]);

    const created = await createVerificationCase(context, 'IDENTITY');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/verification/cases');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ verificationType: 'IDENTITY' });
    expect(created.typeText).toBe('身份认证');
  });
});

describe('requestDocumentUpload', () => {
  it('asks for a signed URL and sends no file hash', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: uploadTarget() } }]);

    const target = await requestDocumentUpload(context, 'case-1', {
      documentType: 'ID_CARD',
      contentType: 'image/jpeg',
      byteSize: 2048,
    });

    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/verification/cases/case-1/documents/upload-url',
    );

    const body = JSON.parse(String(calls[0]?.body));
    expect(body).toEqual({
      documentType: 'ID_CARD',
      contentType: 'image/jpeg',
      byteSize: 2048,
    });
    // The mini program cannot compute SHA-256, so the server does it instead.
    expect(body.fileHash).toBeUndefined();

    expect(target.uploadUrl).toContain('signature=abc');
    expect(target.headers['content-type']).toBe('image/jpeg');
  });
});

describe('submitVerificationCase', () => {
  it('is a command: POST, no body', async () => {
    const { context, calls } = harness([
      { status: 200, body: { data: caseOf({ status: 'SUBMITTED' }) } },
    ]);

    const submitted = await submitVerificationCase(context, 'case-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/verification/cases/case-1/submit');
    expect(calls[0]?.body).toBeUndefined();
    expect(submitted.statusText).toBe('已提交');
  });
});

describe('submitEvidence', () => {
  it('starts a case, uploads at the signed URL, then submits — in that order', async () => {
    const { context, calls } = harness([
      { status: 201, body: { data: caseOf() } },
      { status: 201, body: { data: uploadTarget() } },
      { status: 200, body: { data: caseOf({ status: 'SUBMITTED' }) } },
    ]);

    const seen: string[] = [];
    await submitEvidence(context, {
      verificationType: 'IDENTITY',
      documentType: 'ID_CARD',
      contentType: 'image/jpeg',
      byteSize: 2048,
      upload: async (target) => {
        seen.push(target.uploadUrl);
      },
    });

    expect(calls.map((call) => call.url.split('/api/v1')[1])).toEqual([
      '/verification/cases',
      '/verification/cases/case-1/documents/upload-url',
      '/verification/cases/case-1/submit',
    ]);
    // The bytes go to the object store, never through the platform's JSON API.
    expect(seen[0]).toContain('objects.example.com');
  });
});
