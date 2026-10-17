import { describe, expect, it } from 'vitest';

import { PassthroughNotificationVerifier } from '../../../src/modules/payments/infrastructure/passthrough-notification.verifier';

describe('PassthroughNotificationVerifier', () => {
  it('parses the platform payload for the mock gateway', async () => {
    const verifier = new PassthroughNotificationVerifier({ environment: 'test' });

    const result = await verifier.verify({
      headers: {},
      body: JSON.stringify({
        orderNo: 'MO-20261001-ABCDEF01',
        providerTransactionId: 'txn-1',
        amountMinor: 20_000,
        status: 'SUCCEEDED',
        rawRef: 'stored/callback/1',
      }),
    });

    expect(result).toEqual({
      orderNo: 'MO-20261001-ABCDEF01',
      providerTransactionId: 'txn-1',
      amountMinor: 20_000,
      status: 'SUCCEEDED',
      rawRef: 'stored/callback/1',
    });
  });

  it('refuses to run in production', async () => {
    const verifier = new PassthroughNotificationVerifier({ environment: 'production' });

    await expect(
      verifier.verify({ headers: {}, body: JSON.stringify({ orderNo: 'MO-1' }) }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID', status: 400 });
  });

  it('rejects a payload that is not the platform shape', async () => {
    const verifier = new PassthroughNotificationVerifier({ environment: 'test' });

    for (const body of ['not json', '{}', '{"orderNo":"MO-1"}']) {
      await expect(verifier.verify({ headers: {}, body }), body).rejects.toMatchObject({
        code: 'PAYMENT_CALLBACK_INVALID',
      });
    }
  });
});
