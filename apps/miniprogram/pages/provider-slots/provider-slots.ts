import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { SlotManageRowView } from '../../src/core/provider-desk';
import { slotWindow, today } from '../../src/core/slot-form';
import { confirm } from '../../src/platform/wechat';
import { createSlot, deleteSlot, listMySlots } from '../../src/services/provider-desk';

/**
 * 可预约时段（T032）— `specs/11` §Provider pages：Availability.
 *
 * The provider offers windows; they do not decide whether two windows may
 * overlap. That invariant is the server's (T011), so a conflict comes back as an
 * error and is shown as one — a client-side rule would drift from the real one
 * (FE-43 验收：重叠/冲突提示来自服务端).
 */
interface ProviderSlotsData {
  loading: boolean;
  acting: boolean;
  error: string;
  notice: string;
  slots: SlotManageRowView[];
  day: string;
  startTime: string;
  durationMinutes: number;
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderSlotsData,
  { context: MentorContext }
> & {
  context: MentorContext;
  providerId: string;
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    acting: false,
    error: '',
    notice: '',
    slots: [] as SlotManageRowView[],
    day: today(),
    startTime: '19:00',
    durationMinutes: 60,
  },

  context: ensureContext(),
  providerId: '',

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
    try {
      const slots = await listMySlots(this.context, this.providerId);
      this.setData({ loading: false, slots });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  onPickDay(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    this.setData({ day: String(event.detail.value ?? this.data.day) });
  },

  onPickTime(this: PageInstance, event: WechatMiniprogram.CustomEvent): void {
    this.setData({ startTime: String(event.detail.value ?? this.data.startTime) });
  },

  onSelectDuration(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const minutes = Number(event.currentTarget.dataset.minutes ?? 60);
    this.setData({ durationMinutes: minutes });
  },

  async onAddSlot(this: PageInstance): Promise<void> {
    this.setData({ acting: true, notice: '' });
    try {
      await createSlot(
        this.context,
        slotWindow(this.data.day, this.data.startTime, this.data.durationMinutes),
      );
      this.setData({ acting: false });
      await this.load();
    } catch (error) {
      // VALIDATION_ERROR / PROVIDER_NOT_APPROVED: the server's rule, shown.
      this.setData({ acting: false, notice: errorMessageOf(error) });
    }
  },

  async onDeleteSlot(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const slotId = String(event.currentTarget.dataset.id ?? '');
    if (slotId.length === 0) {
      return;
    }

    const agreed = await confirm({ title: '删除时段', content: '删除后家长将无法预约该时段。' });
    if (!agreed) {
      return;
    }

    this.setData({ acting: true, notice: '' });
    try {
      const deleted = await deleteSlot(this.context, slotId);
      this.setData({ acting: false, notice: deleted ? '时段已删除。' : '该时段无法删除。' });
      await this.load();
    } catch (error) {
      this.setData({ acting: false, notice: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    if (this.providerId.length === 0) {
      return;
    }
    await this.load();
  },
};

Page<ProviderSlotsData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderSlotsData,
    { context: MentorContext }
  >,
);
