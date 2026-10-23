import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { ReviewRowView } from '../../src/core/provider-view';
import { providerReviews } from '../../src/services/discovery';

/**
 * 我的评价（T032）— `specs/11` §Provider pages：Reviews.
 *
 * The provider reads the public list: it is the same payload a parent sees, and
 * a hidden review is `content: null` there too, so nothing a moderator hid
 * becomes visible here (FE-45 验收：仅公开评价，隐藏内容不展示).
 */
interface ProviderReviewsData {
  loading: boolean;
  loadingMore: boolean;
  error: string;
  reviews: ReviewRowView[];
  total: number;
  hasMore: boolean;
  empty: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderReviewsData,
  { context: MentorContext }
> & {
  context: MentorContext;
  providerId: string;
  page: number;
  load(): Promise<void>;
};

const PAGE_SIZE = 20;

const pageOptions = {
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    reviews: [] as ReviewRowView[],
    total: 0,
    hasMore: false,
    empty: false,
  },

  context: ensureContext(),
  providerId: '',
  page: 1,

  onLoad(this: PageInstance, options: Record<string, string | undefined>): void {
    const providerId = String(options.providerId ?? '');
    if (providerId.length === 0) {
      this.setData({ loading: false, error: '缺少导师编号。' });
      return;
    }
    this.providerId = providerId;
    void this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    this.page = 1;
    try {
      const page = await providerReviews(this.context, this.providerId, {
        page: 1,
        pageSize: PAGE_SIZE,
      });
      this.setData({
        loading: false,
        reviews: page.items,
        total: page.total,
        hasMore: page.items.length < page.total,
        empty: page.items.length === 0,
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onLoadMore(this: PageInstance): Promise<void> {
    if (this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    this.setData({ loadingMore: true });
    try {
      const page = await providerReviews(this.context, this.providerId, {
        page: this.page + 1,
        pageSize: PAGE_SIZE,
      });
      this.page += 1;
      this.setData({
        loadingMore: false,
        reviews: [...this.data.reviews, ...page.items],
        total: page.total,
        hasMore: this.data.reviews.length + page.items.length < page.total,
      });
    } catch (error) {
      this.setData({ loadingMore: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.providerId.length === 0) {
      return;
    }
    await this.load();
  },
};

Page<ProviderReviewsData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderReviewsData,
    { context: MentorContext }
  >,
);
