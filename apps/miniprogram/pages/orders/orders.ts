import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { ensureSession } from '../../src/services/auth';
import type { SessionState } from '../../src/services/auth';

/**
 * orders tab (T028): shell only.
 *
 * The screen exists so navigation, the session and the empty/permission states
 * are real; the domain list arrives with its own task (see
 * `implementation/frontend/frontend-task-breakdown.md`).
 */
interface OrdersData {
  loading: boolean;
  sessionState: SessionState;
}

type PageInstance = WechatMiniprogram.Page.Instance<OrdersData, { context: MentorContext }>;

const pageOptions = {
  data: {
    loading: false,
    sessionState: 'unknown',
  },

  context: ensureContext(),

  async onShow(this: PageInstance): Promise<void> {
    this.setData({ loading: true });
    const sessionState = await ensureSession(this.context);
    this.setData({ sessionState, loading: false });
  },
};

// The WeChat typings only describe lifecycle methods; `onShow` is ours.
Page<OrdersData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<OrdersData, { context: MentorContext }>,
);
