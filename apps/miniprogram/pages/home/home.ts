import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { HomeRole, NextActionView } from '../../src/core/home';
import { confirm, navigateTo, showToast } from '../../src/platform/wechat';
import { ensureSession } from '../../src/services/auth';
import type { SessionState } from '../../src/services/auth';
import { loadHome } from '../../src/services/home';
import { completeOrder, confirmOrder, startOrder } from '../../src/services/provider-desk';

/**
 * Home (P0) — the to-do list of the marketplace, for both sides.
 *
 * The first screen answers "what do I do next": the parent sees payment, the
 * wait for acceptance and the lesson ahead; the mentor sees today's lessons and
 * the orders waiting for accept / start / finish. Everything else is a second
 * screen, reachable from the entries at the bottom.
 */
interface HomeData {
  loading: boolean;
  sessionState: SessionState;
  error: string;
  displayName: string;
  role: HomeRole;
  hasDesk: boolean;
  deskName: string;
  items: NextActionView[];
  today: NextActionView[];
  conversations: number;
  database: 'up' | 'down' | 'unknown';
  busy: boolean;
}

type PageInstance = WechatMiniprogram.Page.Instance<HomeData, { context: MentorContext }> & {
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    sessionState: 'unknown',
    error: '',
    displayName: '',
    role: 'parent',
    hasDesk: false,
    deskName: '',
    items: [] as NextActionView[],
    today: [] as NextActionView[],
    conversations: 0,
    database: 'unknown',
    busy: false,
  },

  context: ensureContext(),

  async onShow(this: PageInstance): Promise<void> {
    await this.load();
  },

  async onPullDownRefresh(this: PageInstance): Promise<void> {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });

    const sessionState = await ensureSession(this.context);
    this.setData({ sessionState });
    if (sessionState !== 'signed-in') {
      this.setData({ loading: false });
      return;
    }

    try {
      const home = await loadHome(this.context);
      this.setData({
        loading: false,
        displayName: home.displayName,
        role: home.role,
        hasDesk: home.desk !== null,
        deskName: home.desk?.publicName ?? '',
        items: home.role === 'parent' ? home.parentToDo : home.providerToDo,
        today: home.today,
        conversations: home.conversations,
        database: home.database,
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },

  /** Parent ⇄ mentor. The same account can be both; the switch is a tap. */
  onSwitchRole(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const role = String(event.currentTarget.dataset.role ?? 'parent') as HomeRole;
    if (role === 'provider' && !this.data.hasDesk) {
      showToast('还不是导师，可先在「导师工作台」申请入驻。');
      return;
    }
    if (role === this.data.role) {
      return;
    }
    this.setData({ role });
    void this.load();
  },

  onOpenDiscover(): void {
    wx.switchTab({ url: '/pages/discover/discover' });
  },

  onOpenOrders(): void {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  onOpenMessages(): void {
    wx.switchTab({ url: '/pages/messages/messages' });
  },

  onOpenDesk(): void {
    navigateTo('/pages/provider-desk/provider-desk');
  },

  onOpenOrder(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id.length > 0) {
      navigateTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(id)}`);
    }
  },

  /**
   * Run a card's action.
   *
   * A command (accept / start / finish) is confirmed first and then re-reads
   * the home: the server owns the state machine, so the screen shows whatever
   * it answers instead of assuming the write worked.
   */
  async onAction(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? 'view');

    if (action === 'pay') {
      navigateTo(`/pages/payment/payment?id=${encodeURIComponent(id)}`);
      return;
    }
    if (action === 'view' || action === 'wait') {
      navigateTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(id)}`);
      return;
    }

    const titles: Record<string, { title: string; content: string }> = {
      confirm: { title: '接单', content: '接单后课程正式确定，家长可以看到。' },
      start: { title: '开始服务', content: '标记开始后进入服务中状态。' },
      complete: { title: '完成服务', content: '完成后进入结算，不可撤销。' },
    };
    const prompt = titles[action];
    if (prompt === undefined) {
      return;
    }

    const agreed = await confirm(prompt);
    if (!agreed) {
      return;
    }

    this.setData({ busy: true });
    try {
      if (action === 'confirm') {
        await confirmOrder(this.context, id);
      } else if (action === 'start') {
        await startOrder(this.context, id);
      } else {
        await completeOrder(this.context, id);
      }
      await this.load();
    } catch (error) {
      showToast(errorMessageOf(error));
    }
    this.setData({ busy: false });
  },
};

// The WeChat typings only describe lifecycle methods; the rest is ours.
Page<HomeData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<HomeData, { context: MentorContext }>,
);
