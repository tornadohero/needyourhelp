import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import {
  DEFAULT_FILTER,
  activeFilterCount,
  filterSummary,
  normalizeFilter,
} from '../../src/core/filters';
import type { ProviderFilter } from '../../src/core/filters';
import { canLoadMore, loadMoreProviders, loadProviders } from '../../src/services/discovery';
import type { ListState } from '../../src/core/paging';
import type { ProviderRowView } from '../../src/core/provider-view';

/**
 * 发现导师（T030）— `specs/11` §Parent pages：Tutor search / Filter sheet / Tutor list.
 *
 * The screen shows what the server answers: a bounded, filtered, paginated list.
 * There is no keyword search because the API has no keyword field — the filters
 * that exist are the ones offered here, and nothing is filtered client-side.
 */
interface DiscoverData {
  loading: boolean;
  loadingMore: boolean;
  error: string;
  empty: boolean;
  rows: ProviderRowView[];
  total: number;
  hasMore: boolean;
  filter: ProviderFilter;
  draft: ProviderFilter;
  activeCount: number;
  summary: string[];
  showFilter: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<DiscoverData, { context: MentorContext }> & {
  state: ListState<ProviderRowView>;
  load(): Promise<void>;
  applyState(): void;
};

const pageOptions = {
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    empty: false,
    rows: [] as ProviderRowView[],
    total: 0,
    hasMore: false,
    filter: DEFAULT_FILTER,
    draft: DEFAULT_FILTER,
    activeCount: 0,
    summary: [] as string[],
    showFilter: false,
  },

  context: ensureContext(),
  state: { items: [], total: 0, page: 0, pageSize: 20 } as ListState<ProviderRowView>,

  async onShow(this: PageInstance): Promise<void> {
    if (this.state.page === 0) {
      await this.load();
    }
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      this.state = await loadProviders(this.context, { filter: this.data.filter });
      this.applyState();
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },

  /** Pull-up to load more: the list is bounded, so it grows page by page. */
  async onReachBottom(this: PageInstance): Promise<void> {
    if (!canLoadMore(this.state) || this.data.loadingMore) {
      return;
    }

    this.setData({ loadingMore: true });
    try {
      const { state } = await loadMoreProviders(this.context, this.state, {
        filter: this.data.filter,
      });
      this.state = state;
      this.applyState();
    } catch (error) {
      this.setData({ loadingMore: false, error: errorMessageOf(error) });
      return;
    }
    this.setData({ loadingMore: false });
  },

  applyState(this: PageInstance): void {
    const state = this.state;
    this.setData({
      loading: false,
      loadingMore: false,
      rows: state.items,
      total: state.total,
      empty: state.items.length === 0,
      hasMore: canLoadMore(state),
    });
  },

  onOpenFilter(this: PageInstance): void {
    this.setData({ showFilter: true, draft: this.data.filter });
  },

  onCloseFilter(this: PageInstance): void {
    this.setData({ showFilter: false, draft: this.data.filter });
  },

  onCityInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: { ...this.data.draft, city: String(event.detail.value ?? '') } });
  },

  onSubjectInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: { ...this.data.draft, subject: String(event.detail.value ?? '') } });
  },

  onGradeInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: { ...this.data.draft, grade: String(event.detail.value ?? '') } });
  },

  onMinPriceInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: { ...this.data.draft, minPrice: numberOrNull(event.detail.value) } });
  },

  onMaxPriceInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draft: { ...this.data.draft, maxPrice: numberOrNull(event.detail.value) } });
  },

  onToggleVerified(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    this.setData({
      draft: { ...this.data.draft, verifiedOnly: Boolean(event.detail.value) },
    });
  },

  onPickDelivery(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const mode = String(event.currentTarget.dataset.mode ?? '');
    const current = this.data.draft.deliveryMode;
    const next = current === mode ? '' : (mode as ProviderFilter['deliveryMode']);
    this.setData({ draft: { ...this.data.draft, deliveryMode: next } });
  },

  /**
   * Pick a sort.
   *
   * These chips sit on the list, not in the filter sheet, so a tap is the whole
   * gesture: it applies at once and the list is re-read from the server. Only
   * the sheet's chips wait for "应用" — that is the difference between this and
   * `onPickDelivery`.
   *
   * Normalised on the way out, so an unknown sort falls back to the default
   * instead of producing a request the server would refuse.
   */
  onPickSort(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const requested = String(event.currentTarget.dataset.sort ?? 'relevance');
    const sort = normalizeFilter({
      ...this.data.filter,
      sort: requested as ProviderFilter['sort'],
    }).sort;

    if (sort === this.data.filter.sort) {
      return;
    }

    this.setData({ filter: { ...this.data.filter, sort }, draft: { ...this.data.draft, sort } });
    void this.load();
  },

  async onApplyFilter(this: PageInstance): Promise<void> {
    // Normalised here too: a value the server would refuse never leaves the screen.
    const filter = normalizeFilter(this.data.draft);
    this.setData({
      filter,
      showFilter: false,
      activeCount: activeFilterCount(filter),
      summary: filterSummary(filter),
    });
    await this.load();
  },

  async onResetFilter(this: PageInstance): Promise<void> {
    this.setData({
      filter: DEFAULT_FILTER,
      draft: DEFAULT_FILTER,
      showFilter: false,
      activeCount: 0,
      summary: [],
    });
    await this.load();
  },

  onOpenProvider(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id.length === 0) {
      return;
    }
    wx.navigateTo({ url: `/pages/provider/provider?id=${id}` });
  },
};

// The WeChat typings only describe lifecycle methods; the handlers above are ours.
Page<DiscoverData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    DiscoverData,
    { context: MentorContext }
  >,
);

/** Empty input means "no bound", not zero — the two mean different things. */
function numberOrNull(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}
