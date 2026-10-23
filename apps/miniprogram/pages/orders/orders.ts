import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { ListState } from '../../src/core/paging';
import type { OrderRowView } from '../../src/core/order-view';
import { navigateTo } from '../../src/platform/wechat';
import { ensureSession } from '../../src/services/auth';
import type { SessionState } from '../../src/services/auth';
import { canLoadMoreOrders, loadMoreOrders, loadOrders } from '../../src/services/orders';

/**
 * 我的订单（T031）— `specs/11` §Parent pages：Order list (Tab 4).
 *
 * The list is the server's, paged and bounded: a screen never loads "everything"
 * and never re-sorts or re-filters what came back (`specs/05` §Orders).
 *
 * A row is a link, not a form: nothing here writes a status. Commands live on
 * the detail screen, where the order's own state can decide what to offer.
 */
interface OrdersData {
  loading: boolean;
  loadingMore: boolean;
  error: string;
  sessionState: SessionState;
  orders: OrderRowView[];
  hasMore: boolean;
  empty: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<OrdersData, { context: MentorContext }> & {
  context: MentorContext;
  state: ListState<OrderRowView> | null;
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: false,
    loadingMore: false,
    error: '',
    sessionState: 'unknown',
    orders: [] as OrderRowView[],
    hasMore: false,
    empty: false,
  },

  context: ensureContext(),
  state: null as ListState<OrderRowView> | null,

  async onShow(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    const sessionState = await ensureSession(this.context);
    this.setData({ sessionState });
    if (sessionState !== 'signed-in') {
      this.setData({ loading: false });
      return;
    }
    await this.load();
  },

  async load(this: PageInstance): Promise<void> {
    try {
      const state = await loadOrders(this.context);
      this.state = state;
      this.setData({
        loading: false,
        orders: state.items,
        hasMore: canLoadMoreOrders(state),
        empty: state.items.length === 0,
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onLoadMore(this: PageInstance): Promise<void> {
    if (this.state === null || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    this.setData({ loadingMore: true });
    try {
      const { state } = await loadMoreOrders(this.context, this.state);
      this.state = state;
      this.setData({
        loadingMore: false,
        orders: state.items,
        hasMore: canLoadMoreOrders(state),
      });
    } catch (error) {
      this.setData({ loadingMore: false, error: errorMessageOf(error) });
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

// The WeChat typings only describe lifecycle methods; `onShow` is ours.
Page<OrdersData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<OrdersData, { context: MentorContext }>,
);
