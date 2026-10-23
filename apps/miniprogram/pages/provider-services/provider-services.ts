import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { errorMessageOf } from '../../src/core/errors';
import type { ServiceManageRowView } from '../../src/core/provider-desk';
import {
  SERVICE_PROBLEM_TEXTS,
  ServiceInvalidError,
  newServiceDraft,
  withDescription,
  withDuration,
  withPriceYuan,
  withSubjectCodes,
  withTitle,
} from '../../src/core/service-form';
import type { ServiceDraft } from '../../src/core/service-form';
import { showToast } from '../../src/platform/wechat';
import {
  createService,
  listMyServices,
  publishService,
  unpublishService,
} from '../../src/services/provider-desk';

/**
 * 服务管理（T032）— `specs/11` §Provider pages：Service editor.
 *
 * A provider sets their own title, duration, price and subjects — that is their
 * decision to make. Publishing is not: it is a command, and the server refuses
 * it while the provider is not approved. The refusal is shown, because a
 * provider who cannot publish needs to know why (FE-42 验收).
 */
interface ProviderServicesData {
  loading: boolean;
  creating: boolean;
  error: string;
  problem: string;
  notice: string;
  services: ServiceManageRowView[];
  title: string;
  description: string;
  durationMinutes: number;
  priceYuan: string;
  subjectText: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderServicesData,
  { context: MentorContext }
> & {
  context: MentorContext;
  draft: ServiceDraft;
  load(): Promise<void>;
  command(
    event: WechatMiniprogram.TouchEvent,
    run: (context: MentorContext, serviceId: string) => Promise<ServiceManageRowView>,
  ): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    creating: false,
    error: '',
    problem: '',
    notice: '',
    services: [] as ServiceManageRowView[],
    title: '',
    description: '',
    durationMinutes: 60,
    priceYuan: '',
    subjectText: '',
  },

  context: ensureContext(),
  draft: newServiceDraft(),

  onLoad(this: PageInstance): void {
    this.draft = withDuration(newServiceDraft(), 60);
    void this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const services = await listMyServices(this.context);
      this.setData({ loading: false, services });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  onInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    const field = String(event.currentTarget.dataset.field ?? '');
    const value = String(event.detail.value ?? '');

    if (field === 'title') {
      this.draft = withTitle(this.draft, value);
      this.setData({ title: this.draft.title });
    } else if (field === 'description') {
      this.draft = withDescription(this.draft, value);
      this.setData({ description: this.draft.description });
    } else if (field === 'price') {
      this.draft = withPriceYuan(this.draft, value);
      this.setData({ priceYuan: value });
    } else if (field === 'subjects') {
      // "MATH, ENGLISH" → codes: the platform compares codes, not names (T007).
      this.draft = withSubjectCodes(this.draft, value.split(/[,，\s]+/));
      this.setData({ subjectText: value });
    }
  },

  onSelectDuration(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const minutes = Number(event.currentTarget.dataset.minutes ?? 0);
    this.draft = withDuration(this.draft, minutes);
    this.setData({ durationMinutes: minutes });
  },

  async onCreate(this: PageInstance): Promise<void> {
    this.setData({ creating: true, problem: '' });
    try {
      const service = await createService(this.context, this.draft);
      this.draft = withDuration(newServiceDraft(), this.data.durationMinutes);
      this.setData({
        creating: false,
        title: '',
        description: '',
        priceYuan: '',
        subjectText: '',
        notice: `已创建「${service.title}」，审核通过后可发布。`,
      });
      await this.load();
    } catch (error) {
      if (error instanceof ServiceInvalidError) {
        this.setData({
          creating: false,
          problem: SERVICE_PROBLEM_TEXTS[error.problems[0] ?? 'NO_TITLE'],
        });
        return;
      }
      // PROVIDER_NOT_APPROVED: the provider learns the gate from the server.
      this.setData({ creating: false, error: errorMessageOf(error) });
      showToast(errorMessageOf(error));
    }
  },

  async onPublish(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    await this.command(event, publishService);
  },

  async onUnpublish(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    await this.command(event, unpublishService);
  },

  async command(
    this: PageInstance,
    event: WechatMiniprogram.TouchEvent,
    run: (context: MentorContext, serviceId: string) => Promise<ServiceManageRowView>,
  ): Promise<void> {
    const serviceId = String(event.currentTarget.dataset.id ?? '');
    if (serviceId.length === 0) {
      return;
    }

    this.setData({ notice: '' });
    try {
      await run(this.context, serviceId);
      await this.load();
    } catch (error) {
      // A refused publish is information, not a crash: show the server's reason.
      this.setData({ notice: errorMessageOf(error) });
      await this.load();
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },
};

Page<ProviderServicesData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderServicesData,
    { context: MentorContext }
  >,
);
