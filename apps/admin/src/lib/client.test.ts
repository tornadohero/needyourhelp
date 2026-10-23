import { describe, expect, it } from 'vitest';

import { createAdminClient } from './client';
import type { AdminClient } from './client';
import { AdminApiError } from './http';
import type { Transport, TransportResponse } from './http';

function harness(answers: TransportResponse[] = []) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] =
    [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client: AdminClient = createAdminClient({
    baseUrl: 'http://api.test',
    transport,
    accessToken: 'token-1',
    requestId: () => 'req-1',
  });

  return { client, calls };
}

function ok(data: unknown): TransportResponse {
  return { status: 200, body: { data } };
}

describe('admin client', () => {
  it('prefixes every call with the versioned base and sends the session', async () => {
    const { client, calls } = harness([ok({ users: { total: 1, active: 1 } })]);

    await client.dashboard();

    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/dashboard');
    expect(calls[0]?.headers.Authorization).toBe('Bearer token-1');
    expect(calls[0]?.headers['X-Request-Id']).toBe('req-1');
  });

  it('turns an error envelope into a typed error carrying the platform code', async () => {
    const { client } = harness([{ status: 403, body: { error: { code: 'FORBIDDEN' } } }]);

    await expect(client.dashboard()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      action: 'forbidden',
    });
  });

  it('answers a transport failure with TRANSPORT_ERROR, never a stack trace', async () => {
    const { client } = harness();

    await expect(client.orders()).rejects.toBeInstanceOf(AdminApiError);
  });
});

describe('provider decisions', () => {
  it('sends the reason: the audit log is the record of why', async () => {
    const { client, calls } = harness([ok({ id: 'provider-1' })]);

    await client.approveProvider('provider-1', '材料齐全');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/providers/provider-1/approve');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ reason: '材料齐全' });
  });

  it('uses one route per transition, never a status write', async () => {
    const answers = [ok({}), ok({}), ok({}), ok({})];
    const { client, calls } = harness(answers);

    await client.rejectProvider('p1', '不合格');
    await client.suspendProvider('p1', '投诉');
    await client.restoreProvider('p1', '已整改');
    await client.approveProvider('p1', '复核通过');

    expect(calls.map((call) => call.url.split('/api/v1')[1])).toEqual([
      '/admin/providers/p1/reject',
      '/admin/providers/p1/suspend',
      '/admin/providers/p1/restore',
      '/admin/providers/p1/approve',
    ]);
  });
});

describe('verification queue', () => {
  it('approves with a reason code, and asks for a document URL with REVIEW', async () => {
    const { client, calls } = harness([ok({}), ok({})]);

    await client.approveVerification('case-1', { reasonCode: 'DOCUMENTS_VERIFIED' });
    await client.documentAccessUrl('case-1', 'doc-1');

    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/verifications/case-1/approve');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ reasonCode: 'DOCUMENTS_VERIFIED' });

    expect(calls[1]?.url).toBe(
      'http://api.test/api/v1/admin/verifications/case-1/documents/doc-1/access-url',
    );
    // The reason code is what the audit log records for a private document.
    expect(JSON.parse(String(calls[1]?.body))).toEqual({ reasonCode: 'REVIEW' });
  });
});

describe('refunds', () => {
  it('carries an idempotency key so a double click refunds once', async () => {
    const { client, calls } = harness([ok({})]);

    await client.refundOrder('order-1', { reason: '时间不合适' }, 'idem-1');

    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/orders/order-1/refund');
    expect(calls[0]?.headers['Idempotency-Key']).toBe('idem-1');
    // No amount: the server decides what is still refundable.
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ reason: '时间不合适' });
  });

  it('sends an amount only when an operator means a partial refund', async () => {
    const { client, calls } = harness([ok({})]);

    await client.refundOrder('order-1', { amountMinor: 5_000 }, 'idem-2');

    expect(JSON.parse(String(calls[0]?.body))).toEqual({ amountMinor: 5_000 });
  });
});

describe('roles and flags', () => {
  it('grants and revokes one role by name', async () => {
    const { client, calls } = harness([ok({}), ok({})]);

    await client.grantRole('user-1', 'OPS');
    await client.revokeRole('user-1', 'OPS');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/users/user-1/roles');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ role: 'OPS' });

    expect(calls[1]?.method).toBe('DELETE');
    expect(calls[1]?.url).toBe('http://api.test/api/v1/admin/users/user-1/roles/OPS');
  });

  it('toggles a flag by key', async () => {
    const { client, calls } = harness([ok({})]);

    await client.setFeatureFlag('career_marketplace_enabled', { enabled: true });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(
      'http://api.test/api/v1/admin/feature-flags/career_marketplace_enabled',
    );
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ enabled: true });
  });
});

describe('taxonomy and rules', () => {
  it('archives a term instead of deleting it', async () => {
    const { client, calls } = harness([ok({})]);

    await client.archiveTaxonomyTerm('term-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/taxonomy/term-1/archive');
  });

  it('publishes a rule through its own command', async () => {
    const { client, calls } = harness([ok({})]);

    await client.publishPlatformRule('rule-1');

    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/platform-rules/rule-1/publish');
  });
});

describe('console credentials', () => {
  it('issues and revokes console access', async () => {
    const { client, calls } = harness([ok({}), ok({})]);

    await client.issueCredential({ userId: 'user-1', username: 'ops1', password: 'secret' });
    await client.revokeCredential('user-1');

    expect(calls[0]?.url).toBe('http://api.test/api/v1/admin/console-credentials');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      userId: 'user-1',
      username: 'ops1',
      password: 'secret',
    });
    expect(calls[1]?.method).toBe('DELETE');
    expect(calls[1]?.url).toBe('http://api.test/api/v1/admin/console-credentials/user-1');
  });
});
