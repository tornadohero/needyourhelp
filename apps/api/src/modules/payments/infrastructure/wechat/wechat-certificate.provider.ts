import type { WeChatPayConfig } from './wechat-pay-config';
import { buildAuthorizationHeader, createNonce, decryptResource } from './wechat-pay-crypto';

/**
 * Platform certificates of WeChat Pay.
 *
 * Notifications are signed with a certificate WeChat owns, and that certificate
 * is itself delivered encrypted (`GET /v3/certificates`) with the APIv3 key. The
 * adapter therefore needs a small certificate source — never a hard-coded PEM
 * (`specs/08-payment-and-settlement.md` §Create payment step 10).
 */
export interface WeChatCertificateProvider {
  /** PEM of the certificate with this serial number, or `null` if unknown. */
  getCertificate(serial: string): Promise<string | null>;
}

interface CertificateResponse {
  data?: {
    serial_no?: string;
    encrypt_certificate?: {
      algorithm?: string;
      nonce?: string;
      associated_data?: string;
      ciphertext?: string;
    };
  }[];
}

export interface CachingCertificateProviderOptions {
  config: WeChatPayConfig;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** How long a fetched certificate is reused, in milliseconds. */
  ttlMs?: number;
  now?: () => Date;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class CachingWeChatCertificateProvider implements WeChatCertificateProvider {
  private readonly certificates = new Map<string, { pem: string; fetchedAt: number }>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: CachingCertificateProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  async getCertificate(serial: string): Promise<string | null> {
    const cached = this.certificates.get(serial);
    if (cached && this.now().getTime() - cached.fetchedAt < this.ttlMs) {
      return cached.pem;
    }

    await this.refresh();
    return this.certificates.get(serial)?.pem ?? null;
  }

  /** Fetch and decrypt every certificate the merchant currently has. */
  async refresh(): Promise<void> {
    const url = '/v3/certificates';
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const nonce = createNonce();

    const response = await this.fetchImpl(`${this.options.config.baseUrl}${url}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'mentor-platform',
        Authorization: buildAuthorizationHeader({
          method: 'GET',
          url,
          timestamp,
          nonce,
          body: '',
          merchantId: this.options.config.merchantId,
          serialNo: this.options.config.merchantSerialNo,
          privateKeyPem: this.options.config.privateKeyPem,
        }),
      },
      signal: AbortSignal.timeout(this.options.config.timeoutMs),
    });

    if (!response.ok) {
      // Never include the response body: it can carry certificate material.
      throw new Error(`WeChat Pay certificate request failed (status ${response.status}).`);
    }

    const payload = (await response.json()) as CertificateResponse;
    const fetchedAt = this.now().getTime();

    for (const entry of payload.data ?? []) {
      const serial = entry.serial_no;
      const encrypted = entry.encrypt_certificate;
      if (!serial || !encrypted?.ciphertext || !encrypted.nonce) {
        continue;
      }

      const pem = decryptResource(
        {
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          associatedData: encrypted.associated_data ?? '',
        },
        this.options.config.apiV3Key,
      );
      this.certificates.set(serial, { pem, fetchedAt });
    }
  }
}
