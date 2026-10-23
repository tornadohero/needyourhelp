import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import {
  BOOKING_PROBLEM_TEXTS,
  BookingIncompleteError,
  newBookingDraft,
  withChild,
  withNote,
  withService,
  withSlot,
} from '../../src/core/booking';
import type { BookingDraft, SlotOptionView } from '../../src/core/booking';
import type { ChildRowView } from '../../src/core/children';
import { errorMessageOf } from '../../src/core/errors';
import type { ServiceRowView } from '../../src/core/provider-view';
import { confirm, redirectTo, showToast } from '../../src/platform/wechat';
import { loadProviderDetail } from '../../src/services/discovery';
import { bookableSlots, createOrder } from '../../src/services/orders';
import { listChildren } from '../../src/services/profile';

/**
 * 创建预约（T031）— `specs/11` §Parent pages：Create booking.
 *
 * What the customer decides here is a service, a window and a child. What the
 * customer never decides is money: the request carries no price, and the total
 * comes back from the server (`specs/05-api-spec.md` §Orders).
 *
 * The window is the slot's own. A client that composed its own times would be
 * asking for a slot the provider never published (T011 claims one whole slot).
 */
interface BookingData {
  loading: boolean;
  submitting: boolean;
  error: string;
  problem: string;
  providerName: string;
  services: ServiceRowView[];
  selectedServiceId: string;
  slots: SlotOptionView[];
  selectedSlotId: string;
  children: ChildRowView[];
  selectedChildId: string;
  note: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<BookingData, { context: MentorContext }> & {
  context: MentorContext;
  draft: BookingDraft;
  providerId: string;
  load(providerId: string, serviceId: string): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    submitting: false,
    error: '',
    problem: '',
    providerName: '',
    services: [] as ServiceRowView[],
    selectedServiceId: '',
    slots: [] as SlotOptionView[],
    selectedSlotId: '',
    children: [] as ChildRowView[],
    selectedChildId: '',
    note: '',
  },

  context: ensureContext(),
  draft: newBookingDraft(''),
  providerId: '',

  onLoad(this: PageInstance, options: Record<string, string | undefined>): void {
    const providerId = String(options.providerId ?? '');
    if (providerId.length === 0) {
      this.setData({ loading: false, error: '缺少导师编号。' });
      return;
    }
    this.providerId = providerId;
    void this.load(providerId, String(options.serviceId ?? ''));
  },

  async load(this: PageInstance, providerId: string, serviceId: string): Promise<void> {
    this.setData({ loading: true, error: '' });
    this.draft = newBookingDraft(providerId);

    try {
      const [detail, children, slots] = await Promise.all([
        loadProviderDetail(this.context, providerId),
        listChildren(this.context),
        bookableSlots(this.context, providerId),
      ]);

      // A service passed by the detail screen wins; otherwise nothing is chosen
      // for the customer, and the submit button says why.
      const preselected = detail.provider.services.some((service) => service.id === serviceId)
        ? serviceId
        : '';
      this.draft = withService(this.draft, preselected.length > 0 ? preselected : null);

      this.setData({
        loading: false,
        providerName: detail.provider.name,
        services: detail.provider.services,
        selectedServiceId: preselected,
        slots,
        children,
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  onSelectService(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const serviceId = String(event.currentTarget.dataset.id ?? '');
    this.draft = withService(this.draft, serviceId.length > 0 ? serviceId : null);
    this.setData({ selectedServiceId: serviceId, problem: '' });
  },

  onSelectSlot(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const slotId = String(event.currentTarget.dataset.id ?? '');
    const slot = this.data.slots.find((item) => item.id === slotId) ?? null;
    this.draft = withSlot(this.draft, slot);
    this.setData({ selectedSlotId: slot === null ? '' : slotId, problem: '' });
  },

  onSelectChild(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const childId = String(event.currentTarget.dataset.id ?? '');
    this.draft = withChild(this.draft, childId.length > 0 ? childId : null);
    this.setData({ selectedChildId: childId, problem: '' });
  },

  onNoteInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    const note = String(event.detail.value ?? '');
    this.draft = withNote(this.draft, note);
    this.setData({ note: this.draft.note });
  },

  async onSubmit(this: PageInstance): Promise<void> {
    const agreed = await confirm({
      title: '提交预约',
      content: '提交后金额由平台按服务价格计算，可在订单详情查看。',
    });
    if (!agreed) {
      return;
    }

    this.setData({ submitting: true, problem: '' });
    try {
      const order = await createOrder(this.context, this.draft);
      // The booking screen must not stay in the back stack: the slot is taken.
      redirectTo(`/pages/order-detail/order-detail?id=${encodeURIComponent(order.id)}`);
    } catch (error) {
      if (error instanceof BookingIncompleteError) {
        this.setData({
          submitting: false,
          problem: BOOKING_PROBLEM_TEXTS[error.problems[0] ?? 'NO_SERVICE'],
        });
        return;
      }
      this.setData({ submitting: false, error: errorMessageOf(error) });
      showToast(errorMessageOf(error));
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.providerId.length === 0) {
      return;
    }
    await this.load(this.providerId, '');
  },
};

Page<BookingData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<BookingData, { context: MentorContext }>,
);
