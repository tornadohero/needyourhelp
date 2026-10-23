import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { OrderDetailView, RefundRowView } from '../../src/core/order-view';
import { confirm, showToast } from '../../src/platform/wechat';
import { cancelOrder, orderDetail, requestRefund } from '../../src/services/orders';

/**
 * 订单详情（T031）— `specs/11` §Parent pages：Order detail.
 *
 * The money screen the spec asks for: service, duration, unit price, total and
 * order number, all from the order the server recorded — never recomputed here
 * (`AGENTS.md` §8).
 *
 * The status is read-only. Cancel and "ask for a refund" are commands; when the
 * server answers `ORDER_INVALID_STATE` (409) the screen is stale, so it reloads
 * and shows the new state instead of offering the button again
 * (`specs/06-verification-state-machine.md` §Order).
 */
interface OrderDetailData {
  loading: boolean;
  acting: boolean;
  error: string;
  notice: string;
  order: OrderDetailView | null;
  refunds: RefundRowView[];
  refundReason: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<OrderDetailData, { context: MentorContext }> & {
  context: MentorContext;
  orderId: string;
  load(orderId: string): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    acting: false,
    error: '',
    notice: '',
    order: null as OrderDetailView | null,
    refunds: [] as RefundRowView[],
    refundReason: '',
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

  async load(this: PageInstance, orderId: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const { order, refunds } = await orderDetail(this.context, orderId);
      this.setData({ loading: false, order, refunds });
    } catch (error) {
      // Not a participant reads as not found: an order id must not be probeable.
      this.setData({ loading: false, error: errorMessageOf(error), order: null });
    }
  },

  onReasonInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ refundReason: String(event.detail.value ?? '') });
  },

  async onCancel(this: PageInstance): Promise<void> {
    const agreed = await confirm({
      title: '取消预约',
      content: '取消后该时段会释放给其他家长，且不可恢复。',
    });
    if (!agreed) {
      return;
    }

    this.setData({ acting: true, notice: '' });
    try {
      const order = await cancelOrder(this.context, this.orderId);
      this.setData({ acting: false, order });
      showToast('订单已取消。');
    } catch (error) {
      // 409: the state moved on. Show the truth instead of the stale button.
      this.setData({ acting: false, notice: errorMessageOf(error) });
      await this.load(this.orderId);
    }
  },

  async onRequestRefund(this: PageInstance): Promise<void> {
    const agreed = await confirm({
      title: '申请退款',
      content: '申请后由平台审核退款，款项不会立即变动。',
    });
    if (!agreed) {
      return;
    }

    this.setData({ acting: true, notice: '' });
    try {
      // No amount is sent: the server answers what it would still refund.
      const answer = await requestRefund(this.context, this.orderId, {
        reason: this.data.refundReason.trim() || undefined,
      });
      this.setData({ acting: false, notice: `已提交退款申请，订单状态：${answer.orderStatus}` });
      await this.load(this.orderId);
    } catch (error) {
      this.setData({ acting: false, notice: errorMessageOf(error) });
      await this.load(this.orderId);
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.orderId.length === 0) {
      return;
    }
    await this.load(this.orderId);
  },
};

Page<OrderDetailData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    OrderDetailData,
    { context: MentorContext }
  >,
);
