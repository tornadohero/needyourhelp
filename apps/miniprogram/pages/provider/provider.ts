import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import { loadProviderDetail } from '../../src/services/discovery';
import { openConversationWithProvider } from '../../src/services/chat';
import type { ProviderDetailView, ReviewRowView, SlotRowView } from '../../src/core/provider-view';
import { hideLoading, navigateTo, showLoading, showToast } from '../../src/platform/wechat';

/**
 * 导师详情（T030）— `specs/11` §Parent pages：Tutor detail / Service detail.
 *
 * Money screens must show service, duration, price and the order number
 * (`specs/11` §Money screens). The order number only exists once an order exists,
 * so it is deliberately absent here: booking is a later task, and a fake order
 * number would be a lie on a money screen.
 */
interface ProviderData {
  loading: boolean;
  error: string;
  provider: ProviderDetailView | null;
  reviews: ReviewRowView[];
  slots: SlotRowView[];
  contacting: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<ProviderData, { context: MentorContext }> & {
  providerId: string;
  load(id: string): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    error: '',
    contacting: false,
    provider: null as ProviderDetailView | null,
    reviews: [] as ReviewRowView[],
    slots: [] as SlotRowView[],
  },

  providerId: '',

  onLoad(this: PageInstance, options: Record<string, string | undefined>): void {
    const id = String(options.id ?? '');
    if (id.length === 0) {
      this.setData({ loading: false, error: '缺少导师编号。' });
      return;
    }
    this.providerId = id;
    void this.load(id);
  },

  async load(this: PageInstance, id: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const { provider, reviews, slots } = await loadProviderDetail(ensureContext(), id);
      this.setData({ loading: false, provider, reviews, slots });
    } catch (error) {
      // NOT_FOUND and FORBIDDEN look the same to a client on purpose.
      this.setData({ loading: false, error: errorMessageOf(error), provider: null });
    }
  },

  /**
   * Open the booking screen for this provider.
   *
   * Nothing is chosen or priced here: the booking screen asks for the service,
   * the slot and the child, and the server decides the money (T031).
   */
  /**
   * Contact this tutor instead of booking.
   *
   * The server resolves the owner and reuses an existing pair conversation, so
   * this is idempotent: tapping twice lands in the same thread. `catchtap`
   * keeps the card's own "open detail" tap from firing too.
   */
  async onContact(this: PageInstance): Promise<void> {
    const id = this.providerId;
    if (id.length === 0 || this.data.contacting) {
      return;
    }

    this.setData({ contacting: true });
    showLoading('正在打开会话…');
    try {
      const conversationId = await openConversationWithProvider(ensureContext(), id);
      hideLoading();
      this.setData({ contacting: false });
      navigateTo(`/pages/chat/chat?id=${encodeURIComponent(conversationId)}`);
    } catch (error) {
      hideLoading();
      this.setData({ contacting: false });
      showToast(errorMessageOf(error));
    }
  },

  onBook(this: PageInstance): void {
    navigateTo(`/pages/booking/booking?providerId=${encodeURIComponent(this.providerId)}`);
  },

  onBookService(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const serviceId = String(event.currentTarget.dataset.id ?? '');
    navigateTo(
      `/pages/booking/booking?providerId=${encodeURIComponent(this.providerId)}&serviceId=${encodeURIComponent(serviceId)}`,
    );
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.providerId.length === 0) {
      return;
    }
    await this.load(this.providerId);
  },
};

Page<ProviderData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderData,
    { context: MentorContext }
  >,
);
