import { describe, expect, it } from 'vitest';

import { MockProviderNotAllowedError } from '../../../src/modules/auth/domain/auth-errors';
import { MockWeChatAuthProvider } from '../../../src/modules/auth/infrastructure/mock-wechat-auth.provider';

describe('MockWeChatAuthProvider', () => {
  it('maps a code to a deterministic identity in dev/test', async () => {
    const provider = new MockWeChatAuthProvider({ environment: 'local' });

    const first = await provider.exchangeCode({ code: 'code-1' });
    const second = await provider.exchangeCode({ code: 'code-1' });
    const other = await provider.exchangeCode({ code: 'code-2' });

    expect(first.openid).toBe(second.openid);
    expect(first.openid).not.toBe(other.openid);
    expect(first.unionid).toBeNull();
  });

  it('rejects an empty code', async () => {
    const provider = new MockWeChatAuthProvider({ environment: 'test' });
    await expect(provider.exchangeCode({ code: '  ' })).rejects.toBeInstanceOf(Error);
  });

  it('is refused in production', async () => {
    const provider = new MockWeChatAuthProvider({ environment: 'production' });

    await expect(provider.exchangeCode({ code: 'code-1' })).rejects.toBeInstanceOf(
      MockProviderNotAllowedError,
    );
  });

  it('is refused when explicitly disabled', async () => {
    const provider = new MockWeChatAuthProvider({ environment: 'local', mockEnabled: false });

    await expect(provider.exchangeCode({ code: 'code-1' })).rejects.toBeInstanceOf(
      MockProviderNotAllowedError,
    );
  });
});
