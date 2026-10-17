import { createHash } from 'node:crypto';

import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import { MockProviderNotAllowedError, WeChatProviderUnavailableError } from '../domain/auth-errors';
import type {
  WeChatAuthProvider,
  WeChatCodeExchangeInput,
  WeChatIdentity,
} from '../domain/wechat-auth.provider';

export interface MockWeChatAuthProviderOptions {
  environment: string;
  /** Extra opt-in switch for isolated dev/test deployments. */
  mockEnabled?: boolean;
}

/**
 * Deterministic WeChat adapter for local development and tests.
 *
 * It never contacts WeChat and it refuses to run in production: mock login must
 * not become a production login path.
 *
 * The mapping is deterministic (`code` -> stable pseudo openid) so tests and
 * seed scripts can predict identities without network access.
 */
export class MockWeChatAuthProvider implements WeChatAuthProvider {
  readonly name = 'mock';

  constructor(private readonly options: MockWeChatAuthProviderOptions) {}

  async exchangeCode(input: WeChatCodeExchangeInput): Promise<WeChatIdentity> {
    this.assertAllowed();

    const code = input.code?.trim();
    if (!code) {
      throw new WeChatProviderUnavailableError('WeChat login code is required.');
    }

    // Deterministic, non-reversible pseudo openid derived from the code.
    const digest = createHash('sha256').update(`mock:${code}`).digest('hex');
    return {
      openid: `mock_openid_${digest.slice(0, 24)}`,
      unionid: null,
    };
  }

  private assertAllowed(): void {
    const environment = this.options.environment ?? 'local';
    const allowed = isMockAdapterAllowed(environment) && this.options.mockEnabled !== false;

    if (!allowed) {
      throw new MockProviderNotAllowedError(
        'Mock WeChat login is only available in isolated dev/test environments.',
      );
    }
  }
}
