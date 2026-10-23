import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { ProviderOrderRowView } from '../../src/core/provider-desk';
import { describeProviderOrder, providerOrdersOnly } from '../../src/core/provider-desk';
import type { ListState } from '../../src/core/paging';
import { appendPage, hasMore, initialList, nextPage } from '../../src/core/paging';
import type { OrderResponse } from '@mentor/api-contracts';
import { navigateTo } from '../../src/platform/wechat';
import { listOrders } from '../../src/services/orders';
import {
  completeOrder,
  confirmOrder,
  myProviderProfile,
  startOrder,
} from '../../src/services/provider-desk';

/**
 * 我的接单（T032）— `specs/11` §Provider pages：Orders.
 *
 * Delivery is three commands — accept, start, finish — and nothing else. There
 * is no status field to edit and no cancel: a provider who cannot deliver asks
 * for the order to be refunded, which is the customer's and then the platform's
 * decision (`specs/06-verification-state-machine.md` §Order).
 *
 * A 409 is not a failure to retry: the order moved on, so the list is reloaded.
 */
interface ProviderOrdersData {
  loading: boolean;
  acting: boolean;
  error: string;
  notice: string;
  orders: ProviderOrderRowView[];
  hasMore: boolean;
  empty: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderOrdersData,
  { context: MentorContext }
> & {
  context: MentorContext;
  state: ListState<OrderResponse> | null;
  deskId: string;
  render(providerId: string): void;
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    acting: false,
    error: '',
    notice: '',
    orders: [] as ProviderOrderRowView[],
    hasMore: false,
    empty: false,
  },

  context: ensureContext(),
  state: null as ListState<OrderResponse> | null,
  deskId: '',

  onLoad(this: PageInstance): void {
    void this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      // `GET /orders` answers every order this account participates in, both as
      // a customer and as a provider, so the desk separates them before showing.
      const [desk, page] = await Promise.all([
        myProviderProfile(this.context),
        listOrders(this.context, { page: 1, pageSize: 20 }),
      ]);

      const state = appendPage(initialList<OrderResponse>(page.pageSize), page);
      this.state = state;
      this.deskId = desk.id;
      this.render(desk.id);
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  /** Turn the loaded page into rows, keeping only this provider's deliveries. */
  render(this: PageInstance, providerId: string): void {
    const state = this.state;
    if (state === null) {
      return;
    }

    const orders = providerOrdersOnly(state.items.map(describeProviderOrder), providerId);
    this.setData({
      loading: false,
      orders,
      hasMore: hasMore(state),
      empty: orders.length === 0,
    });
  },

  async onLoadMore(this: PageInstance): Promise<void> {
    if (this.state === null || !this.data.hasMore || this.data.loading) {
      return;
    }

    const page = nextPage(this.state);
    if (page === null) {
      return;
    }

    try {
      const result = await listOrders(this.context, { page, pageSize: this.state.pageSize });
      this.state = appendPage(this.state, result);
      this.render(this.deskId);
    } catch (error) {
      this.setData({ error: errorMessageOf(error) });
    }
  },

  async onCommand(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const orderId = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? '');
    if (orderId.length === 0) {
      return;
    }

    const run =
      action === 'confirm' ? confirmOrder : action === 'start' ? startOrder : completeOrder;

    this.setData({ acting: true, notice: '' });
    try {
      await run(this.context, orderId);
      this.setData({ acting: false });
      await this.load();
    } catch (error) {
      // ORDER_INVALID_STATE: reload and show what the order is now.
      this.setData({ acting: false, notice: errorMessageOf(error) });
      await this.load();
    }
  },

  onOpenOrder(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id.length === 0) {
      return;
    }
    navigateTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(id)}`);
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },
};

Page<ProviderOrdersData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderOrdersData,
    { context: MentorContext }
  >,
);
