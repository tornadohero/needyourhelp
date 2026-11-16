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
import { CITY_OPTIONS, cityCodeAt, cityIndexOf, cityLabels } from '../../src/core/cities';
import { LAST_FILTER_KEY } from '../../src/core/insights';
import {
  hideLoading,
  navigateTo,
  showLoading,
  showToast,
  writeStored,
} from '../../src/platform/wechat';
import { openConversationWithProvider } from '../../src/services/chat';
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
  contacting: boolean;
  cityLabels: string[];
  cityIndex: number;
  distanceLabels: string[];
  distanceIndex: number;
  ratingLabels: string[];
  ratingIndex: number;
  lessonsLabels: string[];
  lessonsIndex: number;
  /** WXML cannot index an array with a variable; the labels are computed here. */
  cityLabelText: string;
  distanceLabelText: string;
  ratingLabelText: string;
  lessonsLabelText: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<DiscoverData, { context: MentorContext }> & {
  state: ListState<ProviderRowView>;
  load(): Promise<void>;
  applyState(): void;
};

/** Distances are expressed through the fields the platform actually has. */
const DISTANCE_MODES: ProviderFilter['deliveryMode'][] = ['', 'ONLINE', 'OFFLINE', 'HYBRID'];
const RATING_MINIMUMS: (number | null)[] = [null, 4, 4.5, 4.8];
const LESSON_MINIMUMS: (number | null)[] = [null, 10, 30, 50];

function distanceIndex(draft: ProviderFilter): number {
  const index = DISTANCE_MODES.indexOf(draft.deliveryMode);
  return index < 0 ? 0 : index;
}

function ratingIndex(draft: ProviderFilter): number {
  const index = RATING_MINIMUMS.indexOf(draft.minRating);
  return index < 0 ? 0 : index;
}

function lessonsIndex(draft: ProviderFilter): number {
  const index = LESSON_MINIMUMS.indexOf(draft.minCompletedOrders);
  return index < 0 ? 0 : index;
}

/** The four labels a `<picker>` shows, from the current draft. */
function labelTexts(draft: ProviderFilter): {
  cityLabelText: string;
  distanceLabelText: string;
  ratingLabelText: string;
  lessonsLabelText: string;
} {
  const labels = {
    city: cityLabels(),
    distance: ['不限距离', '线上（不限距离）', '同城线下', '两者都可'],
    rating: ['不限', '4.0 分以上', '4.5 分以上', '4.8 分以上'],
    lessons: ['不限', '10 人次以上', '30 人次以上', '50 人次以上'],
  };

  return {
    cityLabelText: labels.city[cityIndexOf(draft.city)] ?? labels.city[0] ?? '',
    distanceLabelText: labels.distance[distanceIndex(draft)] ?? labels.distance[0] ?? '',
    ratingLabelText: labels.rating[ratingIndex(draft)] ?? labels.rating[0] ?? '',
    lessonsLabelText: labels.lessons[lessonsIndex(draft)] ?? labels.lessons[0] ?? '',
  };
}

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
    contacting: false,
    cityLabels: cityLabels(),
    cityIndex: 0,
    distanceLabels: ['不限距离', '线上（不限距离）', '同城线下', '两者都可'],
    distanceIndex: 0,
    ratingLabels: ['不限', '4.0 分以上', '4.5 分以上', '4.8 分以上'],
    ratingIndex: 0,
    lessonsLabels: ['不限', '10 人次以上', '30 人次以上', '50 人次以上'],
    lessonsIndex: 0,
    cityLabelText: CITY_OPTIONS[0]?.name ?? '不限城市',
    distanceLabelText: '不限距离',
    ratingLabelText: '不限',
    lessonsLabelText: '不限',
  },

  state: { items: [], total: 0, page: 0, pageSize: 20 } as ListState<ProviderRowView>,

  async onShow(this: PageInstance): Promise<void> {
    if (this.state.page === 0) {
      await this.load();
    }
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      this.state = await loadProviders(ensureContext(), { filter: this.data.filter });
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
      const { state } = await loadMoreProviders(ensureContext(), this.state, {
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
    const draft = this.data.filter;
    this.setData({
      showFilter: true,
      draft,
      cityIndex: cityIndexOf(draft.city),
      distanceIndex: distanceIndex(draft),
      ratingIndex: ratingIndex(draft),
      lessonsIndex: lessonsIndex(draft),
      ...labelTexts(draft),
    });
  },

  onCloseFilter(this: PageInstance): void {
    this.setData({ showFilter: false, draft: this.data.filter });
  },

  /** A picker chooses a city by its Chinese label; only the code is sent. */
  onCityChange(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    const index = Number(event.detail.value ?? 0);
    if (index < 0 || index >= CITY_OPTIONS.length) {
      return;
    }
    const draft = { ...this.data.draft, city: cityCodeAt(index) };
    this.setData({ cityIndex: index, draft, ...labelTexts(draft) });
  },

  /** The platform has no coordinates: online ignores distance, offline is local. */
  onDistanceChange(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    const index = Number(event.detail.value ?? 0);
    const mode = DISTANCE_MODES[index];
    if (mode === undefined) {
      return;
    }
    const draft = { ...this.data.draft, deliveryMode: mode };
    this.setData({ distanceIndex: index, draft, ...labelTexts(draft) });
  },

  onRatingChange(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    const index = Number(event.detail.value ?? 0);
    const minimum = RATING_MINIMUMS[index];
    if (minimum === undefined) {
      return;
    }
    const draft = { ...this.data.draft, minRating: minimum };
    this.setData({ ratingIndex: index, draft, ...labelTexts(draft) });
  },

  onLessonsChange(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    const index = Number(event.detail.value ?? 0);
    const minimum = LESSON_MINIMUMS[index];
    if (minimum === undefined) {
      return;
    }
    const draft = { ...this.data.draft, minCompletedOrders: minimum };
    this.setData({ lessonsIndex: index, draft, ...labelTexts(draft) });
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

  /**
   * Pick a sort.
   *
   * These chips sit on the list, not in the filter sheet, so a tap is the whole
   * gesture: it applies at once and the list is re-read from the server. Only
   * the sheet's chips wait for "应用" — that is the difference between this and
   * the sheet's pickers.
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
    // Remembered locally, so the home can pick the search up where it was left.
    writeStored(LAST_FILTER_KEY, filter);
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
      cityIndex: 0,
      distanceIndex: 0,
      ratingIndex: 0,
      lessonsIndex: 0,
      ...labelTexts(DEFAULT_FILTER),
    });
    await this.load();
  },

  /**
   * Contact this tutor instead of booking.
   *
   * The server resolves the owner and reuses an existing pair conversation, so
   * this is idempotent: tapping twice lands in the same thread. `catchtap`
   * keeps the card's own "open detail" tap from firing too.
   */
  async onContact(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = String(event.currentTarget.dataset.id ?? '');
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
