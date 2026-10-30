import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import { navigateTo } from '../../src/platform/wechat';
import { listConversations } from '../../src/services/chat';
import type { ConversationRowView } from '../../src/core/chat-view';

/**
 * 消息 tab — the thread list.
 *
 * It shows what the server answers and nothing it does not know: a thread is a
 * counterpart (the name the server joined in), the last words, and when. No
 * unread badge, because the platform keeps no read cursor yet — a badge it
 * cannot back with data would be a lie.
 */
interface MessagesData {
  loading: boolean;
  error: string;
  rows: ConversationRowView[];
  empty: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<MessagesData, { context: MentorContext }> & {
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    error: '',
    rows: [] as ConversationRowView[],
    empty: false,
  },

  context: ensureContext(),

  async onShow(this: PageInstance): Promise<void> {
    // Refresh on every visit: a thread may have new words while the user was
    // in the booking flow.
    await this.load();
  },

  async onPullDownRefresh(this: PageInstance): Promise<void> {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const rows = await listConversations(this.context);
      this.setData({ loading: false, rows, empty: rows.length === 0 });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },

  onOpenChat(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id.length > 0) {
      navigateTo(`/pages/chat/chat?id=${encodeURIComponent(id)}`);
    }
  },
};

// The WeChat typings only describe lifecycle methods; `load` and the tap
// handlers are ours.
Page<MessagesData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    MessagesData,
    { context: MentorContext }
  >,
);
