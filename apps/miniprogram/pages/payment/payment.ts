import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { PaymentSessionView, PaymentStatusView } from '../../src/core/payment';
import type { OrderDetailView } from '../../src/core/order-view';
import { requestPayment, showToast } from '../../src/platform/wechat';
import { orderDetail } from '../../src/services/orders';
import {
  createPaymentSession,
  readPaymentStatus,
  simulateGatewayCallback,
  waitForPayment,
} from '../../src/services/payments';
import { redirectTo } from '../../src/platform/wechat';

/**
 * 支付页（T035b / FE-35）— `specs/11` §Parent pages：Payment.
 *
 * The money screen of the spec: service, duration, unit price, total, order
 * number and the refund rule, all from the order the server recorded.
 *
 * The one rule that shapes everything here: **the client never decides that an
 * order is paid**. `wx.requestPayment` is asked, and then the server is asked —
 * `GET /orders/:id/payment-status` is what the screen believes
 * (`specs/08-payment-and-settlement.md`: the client callback is informational).
 *
 * With the local `MOCK` provider there is no cashier to open, so the page offers
 * an explicitly labelled "模拟支付" action that plays the gateway's callback. It
 * is only reachable when the session says the provider is `MOCK`.
 */
interface PaymentData {
  loading: boolean;
  paying: boolean;
  error: string;
  notice: string;
  order: OrderDetailView | null;
  session: PaymentSessionView | null;
  status: PaymentStatusView | null;
}

type PageInstance = WechatMiniprogram.Page.Instance<PaymentData, { context: MentorContext }> & {
  context: MentorContext;
  orderId: string;
  load(id: string): Promise<void>;
  refresh(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    paying: false,
    error: '',
    notice: '',
    order: null as OrderDetailView | null,
    session: null as PaymentSessionView | null,
    status: null as PaymentStatusView | null,
  },

  context: ensureContext(),
  orderId: '',

  onLoad(this: PageInstance, options: Record<string, string | undefined>): void {
    const id = String(options.id ?? '');
    if (id.length === 0) {
      this.setData({ loading: false, error: '缺少订单编号。' });
      return;
    }
    this.orderId = id;
    void this.load(id);
  },

  async load(this: PageInstance, id: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const { order } = await orderDetail(this.context, id);
      const { view } = await readPaymentStatus(this.context, id).catch(() => ({ view: null }));
      this.setData({ loading: false, order, status: view });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error), order: null });
    }
  },

  /**
   * Ask for a session, open the cashier if the platform gave a signature, then
   * ask the server what actually happened.
   */
  async onPay(this: PageInstance): Promise<void> {
    this.setData({ paying: true, notice: '' });
    try {
      const { view, payParams } = await createPaymentSession(this.context, this.orderId);
      this.setData({ session: view });

      if (payParams !== null) {
        // The cashier is only opened with a real signature in hand.
        const paid = await requestPayment(payParams);
        if (!paid.ok) {
          // "Cancelled" is not "failed": the server still decides.
          this.setData({ paying: false, notice: '支付未完成，可重新发起。' });
          await this.refresh();
          return;
        }
      }

      const outcome = await waitForPayment(this.context, this.orderId, {
        attempts: 10,
        intervalMs: 1_000,
        onPoll: (_, view) => this.setData({ status: view }),
      });

      this.setData({ paying: false });
      if (outcome.outcome === 'paid') {
        showToast('支付成功。');
        // The booking screen's slot is taken: there is nothing to go back to.
        redirectTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(this.orderId)}`);
        return;
      }

      this.setData({ notice: `支付结果：${outcome.view.paymentText}` });
      await this.refresh();
    } catch (error) {
      // ORDER_NOT_PAYABLE and friends: the state is the answer.
      this.setData({ paying: false, notice: errorMessageOf(error) });
      await this.refresh();
    }
  },

  /** Local adapter only: play the gateway's callback so the order can move. */
  async onSimulate(this: PageInstance): Promise<void> {
    this.setData({ paying: true, notice: '' });
    try {
      const { session } = await createPaymentSession(this.context, this.orderId);
      await simulateGatewayCallback(this.context, session);
      const { view } = await readPaymentStatus(this.context, this.orderId);
      this.setData({ paying: false, status: view });

      if (view.outcome === 'paid') {
        showToast('已模拟支付成功。');
        redirectTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(this.orderId)}`);
        return;
      }
      this.setData({ notice: view.paymentText });
    } catch (error) {
      this.setData({ paying: false, notice: errorMessageOf(error) });
    }
  },

  async refresh(this: PageInstance): Promise<void> {
    try {
      const { order } = await orderDetail(this.context, this.orderId);
      this.setData({ order });
    } catch {
      // A refresh failure keeps the last known state on screen.
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.orderId.length === 0) {
      return;
    }
    await this.load(this.orderId);
  },
};

Page<PaymentData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<PaymentData, { context: MentorContext }>,
);
