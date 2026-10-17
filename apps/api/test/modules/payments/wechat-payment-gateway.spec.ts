import { generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { WeChatPaymentGateway } from '../../../src/modules/payments/infrastructure/wechat/wechat-payment.gateway';
import { CachingWeChatCertificateProvider } from '../../../src/modules/payments/infrastructure/wechat/wechat-certificate.provider';
import { WeChatNotificationVerifier } from '../../../src/modules/payments/infrastructure/wechat/wechat-notification.verifier';
import type { WeChatPayConfig } from '../../../src/modules/payments/infrastructure/wechat/wechat-pay-config';
import {
  createNonce,
  encryptResource,
  signRsaSha256,
} from '../../../src/modules/payments/infrastructure/wechat/wechat-pay-crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CERTIFICATE = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const API_V3_KEY = '0123456789abcdef0123456789abcdef';
const SERIAL = 'platform-serial-1';

function config(overrides: Partial<WeChatPayConfig> = {}): WeChatPayConfig {
  return {
    appId: 'wxappid',
    merchantId: '1900000001',
    merchantSerialNo: 'serial-1',
    privateKeyPem: PRIVATE_KEY,
    apiV3Key: API_V3_KEY,
    notifyUrl: 'https://api.example.com/api/v1/payments/wechat/notify',
    baseUrl: 'https://api.mch.weixin.qq.com',
    timeoutMs: 5000,
    ...overrides,
  };
}

/** A fetch stub that records requests and answers from a queue. */
function fetchStub(respond: (request: { url: string; init?: RequestInit }) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();
    calls.push({ url: target, init });
    const body = respond({ url: target, init });
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function certificateFetchStub() {
  const encrypted = encryptResource(CERTIFICATE, API_V3_KEY, 'certificate');
  return fetchStub(() => ({
    data: [
      {
        serial_no: SERIAL,
        encrypt_certificate: {
          algorithm: 'AEAD_AES_256_GCM',
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          associated_data: encrypted.associatedData,
        },
      },
    ],
  }));
}

describe('WeChatPaymentGateway', () => {
  let certificates: CachingWeChatCertificateProvider;

  beforeEach(() => {
    certificates = new CachingWeChatCertificateProvider({
      config: config(),
      fetchImpl: certificateFetchStub().impl,
    });
  });

  it('creates a JSAPI prepay and returns the client parameters', async () => {
    const stub = fetchStub(() => ({ prepay_id: 'prepay-1' }));
    const gateway = new WeChatPaymentGateway({
      config: config(),
      certificates,
      fetchImpl: stub.impl,
      now: () => new Date(1_700_000_000_000),
    });

    const session = await gateway.createMiniProgramPayment({
      orderId: 'order-1',
      orderNo: 'MO-20261001-ABCDEF01',
      amountMinor: 20_000,
      currency: 'CNY',
      description: '数学一对一',
      payerOpenId: 'openid-1',
    });

    // The platform keeps its own id, and the query/callback are keyed by it.
    expect(session.providerTransactionId).toBe('MO20261001ABCDEF01');
    expect(session.prepayReference).toBe('prepay-1');
    expect(session.params).toMatchObject({
      package: 'prepay_id=prepay-1',
      signType: 'RSA',
      appId: 'wxappid',
    });

    // The amount came from the order, and the request was signed.
    const body = JSON.parse(String(stub.calls[0]?.init?.body));
    expect(body).toMatchObject({
      out_trade_no: 'MO20261001ABCDEF01',
      amount: { total: 20_000, currency: 'CNY' },
      payer: { openid: 'openid-1' },
    });
    expect(
      String(
        stub.calls[0]?.init?.headers &&
          (stub.calls[0].init.headers as Record<string, string>).Authorization,
      ),
    ).toContain('WECHATPAY2-SHA256-RSA2048');
  });

  it('refuses a currency WeChat cannot charge and a missing payer', async () => {
    const gateway = new WeChatPaymentGateway({
      config: config(),
      certificates,
      fetchImpl: fetchStub(() => ({ prepay_id: 'prepay-1' })).impl,
    });

    await expect(
      gateway.createMiniProgramPayment({
        orderId: 'order-1',
        orderNo: 'MO-20261001-ABCDEF01',
        amountMinor: 20_000,
        currency: 'USD',
        description: 'x',
        payerOpenId: 'openid-1',
      }),
    ).rejects.toThrow(/CNY/);

    await expect(
      gateway.createMiniProgramPayment({
        orderId: 'order-1',
        orderNo: 'MO-20261001-ABCDEF01',
        amountMinor: 20_000,
        currency: 'CNY',
        description: 'x',
      }),
    ).rejects.toThrow(/openid/);
  });

  it('maps the provider trade state on a query', async () => {
    for (const [tradeState, expected] of [
      ['SUCCESS', 'SUCCEEDED'],
      ['NOTPAY', 'PENDING'],
      ['USER_PAYING', 'PENDING'],
      ['CLOSED', 'CLOSED'],
      ['PAYERROR', 'FAILED'],
    ] as const) {
      const stub = fetchStub(() => ({
        trade_state: tradeState,
        out_trade_no: 'MO20261001ABCDEF01',
        transaction_id: 'txn-1',
        success_time: '2026-10-01T00:00:00+08:00',
        amount: { total: 20_000, currency: 'CNY' },
      }));
      const gateway = new WeChatPaymentGateway({
        config: config(),
        certificates,
        fetchImpl: stub.impl,
      });

      const result = await gateway.queryPayment({ providerTransactionId: 'MO20261001ABCDEF01' });

      expect(result.status, tradeState).toBe(expected);
      expect(result.amountMinor).toBe(20_000);
      expect(stub.calls[0]?.url).toContain('/v3/pay/transactions/out-trade-no/MO20261001ABCDEF01');
    }
  });

  it('asks for a refund against the original trade', async () => {
    const stub = fetchStub(() => ({ refund_id: 'refund-1', status: 'SUCCESS' }));
    const gateway = new WeChatPaymentGateway({
      config: config(),
      certificates,
      fetchImpl: stub.impl,
    });

    const result = await gateway.refund({
      providerTransactionId: 'MO20261001ABCDEF01',
      amountMinor: 5_000,
      reason: 'customer request',
    });

    expect(result).toEqual({ providerRef: 'refund-1', status: 'SUCCEEDED' });
    expect(JSON.parse(String(stub.calls[0]?.init?.body))).toMatchObject({
      out_trade_no: 'MO20261001ABCDEF01',
      amount: { refund: 5_000, currency: 'CNY' },
    });
  });

  it('never leaks a secret when the provider is unreachable', async () => {
    const gateway = new WeChatPaymentGateway({
      config: config(),
      certificates,
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });

    await expect(
      gateway.queryPayment({ providerTransactionId: 'MO20261001ABCDEF01' }),
    ).rejects.toThrow(/unavailable/);
  });
});

describe('WeChat notification verification', () => {
  function signedNotification(options: {
    serial?: string;
    timestamp?: number;
    body: string;
    signature?: string;
    now?: Date;
  }) {
    const timestamp = options.timestamp ?? Math.floor((options.now ?? new Date()).getTime() / 1000);
    const nonce = createNonce();
    const signature =
      options.signature ?? signRsaSha256(`${timestamp}\n${nonce}\n${options.body}\n`, PRIVATE_KEY);

    return {
      headers: {
        'wechatpay-serial': options.serial ?? SERIAL,
        'wechatpay-signature': signature,
        'wechatpay-timestamp': String(timestamp),
        'wechatpay-nonce': nonce,
      },
      body: options.body,
    };
  }

  function encryptedBody(payload: unknown): string {
    const encrypted = encryptResource(JSON.stringify(payload), API_V3_KEY, 'transaction');
    return JSON.stringify({
      id: 'evt-1',
      resource_type: 'encrypt-resource',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        associated_data: encrypted.associatedData,
      },
    });
  }

  function verifier(now: Date, fetchImpl: typeof fetch = certificateFetchStub().impl) {
    return new WeChatNotificationVerifier({
      config: config(),
      certificates: new CachingWeChatCertificateProvider({ config: config(), fetchImpl }),
      now: () => now,
    });
  }

  const now = new Date('2026-10-01T00:00:00.000Z');

  it('verifies and decrypts a payment notification', async () => {
    const body = encryptedBody({
      out_trade_no: 'MO20261001ABCDEF01',
      transaction_id: 'txn-1',
      trade_state: 'SUCCESS',
      amount: { total: 20_000, currency: 'CNY' },
    });

    const result = await verifier(now).verify({ ...signedNotification({ body, now }), body });

    expect(result).toMatchObject({
      orderNo: 'MO20261001ABCDEF01',
      providerTransactionId: 'MO20261001ABCDEF01',
      amountMinor: 20_000,
      status: 'SUCCEEDED',
    });
  });

  it('rejects a tampered body, a bad signature and an unknown certificate', async () => {
    const body = encryptedBody({ out_trade_no: 'MO20261001ABCDEF01', trade_state: 'SUCCESS' });
    const notification = signedNotification({ body, now });

    await expect(
      verifier(now).verify({ headers: notification.headers, body: `${body} ` }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });

    await expect(
      verifier(now).verify(signedNotification({ body, now, signature: 'AAAA' })),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });

    await expect(
      verifier(now).verify(signedNotification({ body, now, serial: 'unknown-serial' })),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });
  });

  it('rejects a stale signature so a captured notification cannot be replayed', async () => {
    const body = encryptedBody({ out_trade_no: 'MO20261001ABCDEF01', trade_state: 'SUCCESS' });
    const stale = signedNotification({
      body,
      timestamp: Math.floor(now.getTime() / 1000) - 600,
    });

    await expect(verifier(now).verify(stale)).rejects.toMatchObject({
      code: 'PAYMENT_CALLBACK_INVALID',
    });
  });

  it('rejects a notification without signature headers or resource', async () => {
    const body = encryptedBody({ out_trade_no: 'MO20261001ABCDEF01', trade_state: 'SUCCESS' });

    await expect(verifier(now).verify({ headers: {}, body })).rejects.toMatchObject({
      code: 'PAYMENT_CALLBACK_INVALID',
    });
    await expect(
      verifier(now).verify({
        ...signedNotification({ body: '{"id":"evt-1"}', now }),
        body: '{"id":"evt-1"}',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });
  });
});
