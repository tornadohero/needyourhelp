import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildAuthorizationHeader,
  buildJsapiPaymentParams,
  decryptResource,
  encryptResource,
  signRsaSha256,
  toOutTradeNo,
  verifyRsaSha256,
} from '../../../src/modules/payments/infrastructure/wechat/wechat-pay-crypto';
import { resolveWeChatPayConfig } from '../../../src/modules/payments/infrastructure/wechat/wechat-pay-config';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const API_V3_KEY = '0123456789abcdef0123456789abcdef';

function configServiceStub(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as never;
}

describe('WeChat Pay crypto', () => {
  it('turns an order number into a valid out_trade_no', () => {
    expect(toOutTradeNo('MO-20261001-ABCDEF01')).toBe('MO20261001ABCDEF01');
    // 6–32 characters, letters and digits only.
    expect(toOutTradeNo('MO-20261001-ABCDEF01')).toMatch(/^[A-Za-z0-9]{6,32}$/);
    expect(() => toOutTradeNo('MO-1')).toThrow(/out_trade_no/);
  });

  it('builds the v3 Authorization header', () => {
    const header = buildAuthorizationHeader({
      method: 'POST',
      url: '/v3/pay/transactions/jsapi',
      timestamp: 1_700_000_000,
      nonce: 'nonce123',
      body: '{"a":1}',
      merchantId: '1900000001',
      serialNo: 'serial-1',
      privateKeyPem: PRIVATE_KEY,
    });

    expect(header.startsWith('WECHATPAY2-SHA256-RSA2048 ')).toBe(true);
    expect(header).toContain('mchid="1900000001"');
    expect(header).toContain('nonce_str="nonce123"');
    expect(header).toContain('serial_no="serial-1"');
    expect(header).toContain('timestamp="1700000000"');

    // The signature is over method\nurl\ntimestamp\nnonce\nbody\n.
    const signature = /signature="([^"]+)"/.exec(header)?.[1] ?? '';
    const message = [
      'POST',
      '/v3/pay/transactions/jsapi',
      '1700000000',
      'nonce123',
      '{"a":1}',
      '',
    ].join('\n');
    expect(verifyRsaSha256(message, signature, PUBLIC_KEY)).toBe(true);
  });

  it('builds the parameters the mini program signs with', () => {
    const params = buildJsapiPaymentParams({
      appId: 'wxappid',
      timeStamp: 1_700_000_000,
      nonceStr: 'nonceStr',
      prepayId: 'prepay-1',
      privateKeyPem: PRIVATE_KEY,
    });

    expect(params).toMatchObject({
      appId: 'wxappid',
      timeStamp: '1700000000',
      nonceStr: 'nonceStr',
      package: 'prepay_id=prepay-1',
      signType: 'RSA',
    });

    const message = 'wxappid\n1700000000\nnonceStr\nprepay_id=prepay-1\n';
    expect(verifyRsaSha256(message, String(params.paySign), PUBLIC_KEY)).toBe(true);
  });

  it('encrypts and decrypts a notification resource', () => {
    const plaintext = JSON.stringify({ out_trade_no: 'MO20261001ABCDEF01' });
    const resource = encryptResource(plaintext, API_V3_KEY, 'transaction');

    expect(resource.ciphertext).not.toContain('MO20261001ABCDEF01');
    expect(
      decryptResource(
        {
          ciphertext: resource.ciphertext,
          nonce: resource.nonce,
          associatedData: resource.associatedData,
        },
        API_V3_KEY,
      ),
    ).toBe(plaintext);
  });

  it('refuses a resource that was tampered with', () => {
    const resource = encryptResource('{"amount":1}', API_V3_KEY, 'transaction');
    const tampered = Buffer.from(resource.ciphertext, 'base64');
    // Flip one bit: the GCM tag no longer matches.
    const first = tampered[0] ?? 0;
    tampered[0] = first === 0 ? 1 : first ^ 0xff;

    expect(() =>
      decryptResource(
        {
          ciphertext: tampered.toString('base64'),
          nonce: resource.nonce,
          associatedData: resource.associatedData,
        },
        API_V3_KEY,
      ),
    ).toThrow();
  });

  it('signs and verifies deterministically', () => {
    const signature = signRsaSha256('message', PRIVATE_KEY);
    expect(verifyRsaSha256('message', signature, PUBLIC_KEY)).toBe(true);
    expect(verifyRsaSha256('other', signature, PUBLIC_KEY)).toBe(false);
    expect(verifyRsaSha256('message', 'not-base64', PUBLIC_KEY)).toBe(false);
  });
});

describe('WeChat Pay configuration', () => {
  it('is absent when nothing is configured', () => {
    expect(resolveWeChatPayConfig(configServiceStub({}), 'local')).toBeNull();
  });

  it('loads every secret from configuration', () => {
    const resolved = resolveWeChatPayConfig(
      configServiceStub({
        WECHAT_PAY_APP_ID: 'wxappid',
        WECHAT_PAY_MCH_ID: '1900000001',
        WECHAT_PAY_SERIAL_NO: 'serial-1',
        WECHAT_PAY_API_V3_KEY: API_V3_KEY,
        WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/api/v1/payments/wechat/notify',
        WECHAT_PAY_PRIVATE_KEY: PRIVATE_KEY,
      }),
      'test',
    );

    expect(resolved).toMatchObject({ appId: 'wxappid', merchantId: '1900000001' });
    expect(resolved?.privateKeyPem ?? '').toContain('PRIVATE KEY');
  });

  it('refuses a partial configuration instead of guessing', () => {
    expect(() =>
      resolveWeChatPayConfig(configServiceStub({ WECHAT_PAY_APP_ID: 'wxappid' }), 'test'),
    ).toThrow(/partially configured/);
  });

  it('requires https in production', () => {
    expect(() =>
      resolveWeChatPayConfig(
        configServiceStub({
          WECHAT_PAY_APP_ID: 'wxappid',
          WECHAT_PAY_MCH_ID: '1900000001',
          WECHAT_PAY_SERIAL_NO: 'serial-1',
          WECHAT_PAY_API_V3_KEY: API_V3_KEY,
          WECHAT_PAY_NOTIFY_URL: 'http://api.example.com/api/v1/payments/wechat/notify',
          WECHAT_PAY_PRIVATE_KEY: PRIVATE_KEY,
        }),
        'production',
      ),
    ).toThrow(/https/);
  });
});
