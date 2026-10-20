import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import { currentUser, ensureSession } from '../../src/services/auth';
import type { CurrentUser, SessionState } from '../../src/services/auth';
import { readiness } from '../../src/services/discovery';

/**
 * Home tab (T028).
 *
 * Every async screen carries the states `specs/11` §UX requirements asks for:
 * loading, empty, error, retry — and "needs login", which is this screen's
 * permission-denied state.
 */
interface HomeData {
  loading: boolean;
  sessionState: SessionState;
  user: CurrentUser | null;
  database: 'up' | 'down' | 'unknown';
  error: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<HomeData, { context: MentorContext }> & {
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    sessionState: 'unknown',
    user: null,
    database: 'unknown',
    error: '',
  },

  context: ensureContext(),

  async onShow(this: PageInstance): Promise<void> {
    await this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });

    const sessionState = await ensureSession(this.context);
    this.setData({ sessionState });

    if (sessionState !== 'signed-in') {
      this.setData({ loading: false, user: null });
      return;
    }

    try {
      const [user, ready] = await Promise.all([currentUser(this.context), readiness(this.context)]);
      this.setData({ user, database: ready.database, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },
};

// The WeChat typings only describe lifecycle methods; `load`/`onRetry` are ours.
Page<HomeData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<HomeData, { context: MentorContext }>,
);
