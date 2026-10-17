import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  assertPage,
  assertPageSize,
  assertPeer,
  assertReportDescription,
} from '../../../src/modules/messaging/domain/conversation-policy';

describe('messaging policy', () => {
  it('refuses a conversation with oneself', () => {
    expect(() => assertPeer('user-1', 'user-1')).toThrow(/another participant/);
    expect(assertPeer('user-1', 'user-2')).toBe('user-2');
  });

  it('bounds paging', () => {
    expect(assertPage(undefined)).toBe(1);
    expect(assertPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(assertPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);

    for (const invalid of [{ page: 0 }, { pageSize: 0 }, { pageSize: MAX_PAGE_SIZE + 1 }]) {
      const check =
        invalid.page === undefined
          ? () => assertPageSize(invalid.pageSize)
          : () => assertPage(invalid.page);
      expect(check, JSON.stringify(invalid)).toThrow();
    }
  });

  it('treats an empty report description as absent', () => {
    expect(assertReportDescription(undefined)).toBeNull();
    expect(assertReportDescription('   ')).toBeNull();
    expect(assertReportDescription(' 骚扰内容 ')).toBe('骚扰内容');
    expect(() => assertReportDescription('x'.repeat(2001))).toThrow(/description/);
  });
});
