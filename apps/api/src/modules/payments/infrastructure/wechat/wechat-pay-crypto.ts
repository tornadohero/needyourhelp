import {
  createCipheriv,
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';

/**
 * WeChat Pay API v3 primitives.
 *
 * Request signing: `WECHATPAY2-SHA256-RSA2048` over
 * `method\nurl\ntimestamp\nnonce\nbody\n`, signed with the merchant private key.
 * Notifications are signed with the *platform* certificate and their payload is
 * `AEAD_AES_256_GCM` encrypted with the APIv3 key.
 *
 * Reference: `specs/08-payment-and-settlement.md` and
 * https://pay.wechatpay.cn/doc/v3/merchant/4012791911
 *
 * Nothing here logs a key, a signature or a decrypted payload
 * (`specs/13-security-spec.md` §Logging).
 */

/** `out_trade_no`: 6–32 characters, letters and digits only. */
export function toOutTradeNo(orderNo: string): string {
  const normalized = orderNo.replace(/[^A-Za-z0-9]/g, '');
  if (normalized.length < 6 || normalized.length > 32) {
    throw new Error(`Order number ${orderNo} cannot be used as a WeChat out_trade_no.`);
  }
  return normalized;
}

export function createNonce(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function signRsaSha256(message: string, privateKeyPem: string): string {
  return createSign('RSA-SHA256').update(message, 'utf8').sign(privateKeyPem, 'base64');
}

export function verifyRsaSha256(
  message: string,
  signatureBase64: string,
  certificatePem: string,
): boolean {
  try {
    return createVerify('RSA-SHA256')
      .update(message, 'utf8')
      .verify(certificatePem, signatureBase64, 'base64');
  } catch {
    // A malformed certificate or signature is simply "not verified".
    return false;
  }
}

export interface AuthorizationInput {
  method: string;
  /** Path plus query string, e.g. `/v3/pay/transactions/jsapi`. */
  url: string;
  timestamp: number;
  nonce: string;
  body: string;
  merchantId: string;
  serialNo: string;
  privateKeyPem: string;
}

/** The `Authorization` header of every v3 request. */
export function buildAuthorizationHeader(input: AuthorizationInput): string {
  const message = [
    input.method.toUpperCase(),
    input.url,
    String(input.timestamp),
    input.nonce,
    input.body,
    '',
  ].join('\n');

  const signature = signRsaSha256(message, input.privateKeyPem);

  // Official format: the auth type, then `key="value"` pairs separated by commas.
  return [
    'WECHATPAY2-SHA256-RSA2048',
    [
      `mchid="${input.merchantId}"`,
      `nonce_str="${input.nonce}"`,
      `signature="${signature}"`,
      `timestamp="${input.timestamp}"`,
      `serial_no="${input.serialNo}"`,
    ].join(','),
  ].join(' ');
}

/**
 * Parameters the mini program passes to `wx.requestPayment`.
 *
 * The signature covers `appId\ntimeStamp\nnonceStr\npackage\n` — the client
 * never signs anything itself.
 */
export function buildJsapiPaymentParams(input: {
  appId: string;
  timeStamp: number;
  nonceStr: string;
  prepayId: string;
  privateKeyPem: string;
}): Record<string, unknown> {
  const packageValue = `prepay_id=${input.prepayId}`;
  const message = [input.appId, String(input.timeStamp), input.nonceStr, packageValue, ''].join(
    '\n',
  );

  return {
    appId: input.appId,
    timeStamp: String(input.timeStamp),
    nonceStr: input.nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: signRsaSha256(message, input.privateKeyPem),
  };
}

/** `AEAD_AES_256_GCM` decryption of a notification resource. */
export function decryptResource(
  resource: { ciphertext: string; nonce: string; associatedData: string },
  apiV3Key: string,
): string {
  assertApiV3Key(apiV3Key);

  const raw = Buffer.from(resource.ciphertext, 'base64');
  // The last 16 bytes of the GCM ciphertext are the authentication tag.
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(0, raw.length - 16);

  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(resource.nonce, 'utf8'),
  );
  decipher.setAAD(Buffer.from(resource.associatedData, 'utf8'));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Test helper: encrypt the way WeChat does, so decryption can be exercised. */
export function encryptResource(
  plaintext: string,
  apiV3Key: string,
  associatedData: string,
): { ciphertext: string; nonce: string; associatedData: string } {
  assertApiV3Key(apiV3Key);

  const nonce = createNonce(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
    nonce,
    associatedData,
  };
}

/** The APIv3 key is a 32-byte symmetric key (`specs/04`: never in the database). */
export function assertApiV3Key(apiV3Key: string): void {
  if (Buffer.from(apiV3Key, 'utf8').length !== 32) {
    throw new Error('The WeChat APIv3 key must be exactly 32 bytes.');
  }
}
