import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import { showToast } from '../../src/platform/wechat';
import { loadThread, sendMessage } from '../../src/services/chat';
import type { MessageView } from '../../src/core/chat-view';

/**
 * 聊天页 — one thread, bubbles, and a send box.
 *
 * The thread is read once and grows locally as the user sends; a pull-to-
 * refresh re-reads it, which is honest about what the platform can do — there
 * is no push channel yet, so "someone replied" is discovered by opening the
 * thread, not by being told.
 */
interface ChatData {
  loading: boolean;
  sending: boolean;
  error: string;
  draft: string;
  messages: MessageView[];
  /** `scroll-into-view` target, so a new bubble slides into sight. */
  intoView: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<ChatData, { context: MentorContext }> & {
  conversationId: string;
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    sending: false,
    error: '',
    draft: '',
    messages: [] as MessageView[],
    intoView: '',
  },

  context: ensureContext(),
  conversationId: '',

  onLoad(this: PageInstance, query: Record<string, string | undefined>): void {
    this.conversationId = String(query.id ?? '');
    void this.load();
  },

  async onPullDownRefresh(this: PageInstance): Promise<void> {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load(this: PageInstance): Promise<void> {
    if (this.conversationId.length === 0) {
      this.setData({ loading: false, error: '会话不存在' });
      return;
    }

    try {
      const thread = await loadThread(this.context, this.conversationId);
      wx.setNavigationBarTitle({ title: thread.title });
      this.setData({
        loading: false,
        error: '',
        messages: thread.messages,
        intoView: thread.messages[thread.messages.length - 1]?.id ?? '',
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  onDraftInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: String(event.detail.value ?? '') });
  },

  async onSend(this: PageInstance): Promise<void> {
    const body = this.data.draft.trim();
    if (body.length === 0 || this.data.sending) {
      return;
    }

    this.setData({ sending: true });
    try {
      const sent = await sendMessage(this.context, this.conversationId, body);
      const messages = [...this.data.messages, sent];
      // The sent bubble is the truth: it shows what the transport accepted.
      this.setData({ sending: false, draft: '', messages, intoView: sent.id });
    } catch (error) {
      this.setData({ sending: false });
      showToast(errorMessageOf(error));
    }
  },
};

// The WeChat typings only describe lifecycle methods; the rest is ours.
Page<ChatData, { context: MentorContext; conversationId: string }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ChatData,
    { context: MentorContext; conversationId: string }
  >,
);
