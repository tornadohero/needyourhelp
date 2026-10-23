import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import type { CapabilityTypeName } from '@mentor/api-contracts';
import {
  APPLICATION_PROBLEM_TEXTS,
  ApplicationInvalidError,
  CAPABILITY_TEXTS,
} from '../../src/core/provider-desk';
import type { ProviderDeskView, VerificationRowView } from '../../src/core/provider-desk';
import { errorMessageOf } from '../../src/core/errors';
import { confirm, navigateTo, showToast } from '../../src/platform/wechat';
import {
  applyAsProvider,
  myProviderProfile,
  myVerification,
  replaceProfile,
  submitApplication,
} from '../../src/services/provider-desk';

/**
 * 导师工作台（T032）— `specs/11` §Provider pages：Provider onboarding /
 * Verification status.
 *
 * The provider reads their own record here, including what the public payload
 * hides (approval, `searchable`, capability state). What they cannot do is set
 * any of it: publishing and submitting are commands, and a refusal is shown with
 * the server's reason rather than hidden behind a missing button
 * (`specs/01-business-rules.md` §Provider approval).
 */
interface ProviderDeskData {
  loading: boolean;
  acting: boolean;
  error: string;
  notice: string;
  desk: ProviderDeskView | null;
  verifications: VerificationRowView[];
  /** `false` until an application exists: then the form is the screen. */
  hasProvider: boolean;
  capabilities: { type: CapabilityTypeName; label: string; on: boolean }[];
  publicName: string;
  headline: string;
  bio: string;
  cityCode: string;
  /** Editing is a PUT replacement: the whole profile is sent back. */
  editing: boolean;
  editName: string;
  editHeadline: string;
  editBio: string;
  editCity: string;
  editCapabilities: { type: CapabilityTypeName; label: string; on: boolean }[];
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderDeskData,
  { context: MentorContext }
> & {
  context: MentorContext;
  load(): Promise<void>;
};

const CAPABILITIES: CapabilityTypeName[] = [
  'STUDENT_TUTOR',
  'GRADUATE_TUTOR',
  'PHD_TUTOR',
  'TEACHER',
];

const pageOptions = {
  data: {
    loading: true,
    acting: false,
    error: '',
    notice: '',
    desk: null as ProviderDeskView | null,
    verifications: [] as VerificationRowView[],
    hasProvider: false,
    capabilities: CAPABILITIES.map((type) => ({ type, label: CAPABILITY_TEXTS[type], on: false })),
    publicName: '',
    headline: '',
    bio: '',
    cityCode: '',
    editing: false,
    editName: '',
    editHeadline: '',
    editBio: '',
    editCity: '',
    editCapabilities: CAPABILITIES.map((type) => ({
      type,
      label: CAPABILITY_TEXTS[type],
      on: false,
    })),
  },

  context: ensureContext(),

  onLoad(this: PageInstance): void {
    void this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const desk = await myProviderProfile(this.context);
      // Verification only exists once there is a provider record.
      const verifications = await myVerification(this.context).catch(() => []);
      this.setData({ loading: false, desk, verifications, hasProvider: true });
    } catch (error) {
      // No application yet is the normal empty state, not a failure.
      this.setData({ loading: false, hasProvider: false, error: errorMessageOf(error) });
    }
  },

  onInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    const field = String(event.currentTarget.dataset.field ?? '');
    const value = String(event.detail.value ?? '');
    if (field === 'publicName') {
      this.setData({ publicName: value });
    } else if (field === 'headline') {
      this.setData({ headline: value });
    } else if (field === 'bio') {
      this.setData({ bio: value });
    } else if (field === 'cityCode') {
      this.setData({ cityCode: value });
    }
  },

  onStartEdit(this: PageInstance): void {
    const desk = this.data.desk;
    if (desk === null) {
      return;
    }
    const claimed = new Set(desk.capabilities.map((capability) => capability.typeText));
    this.setData({
      editing: true,
      editName: desk.name,
      editHeadline: desk.headline,
      editBio: desk.bio,
      editCity: desk.cityCode ?? '',
      editCapabilities: this.data.editCapabilities.map((capability) => ({
        ...capability,
        on: claimed.has(capability.label),
      })),
    });
  },

  onCancelEdit(this: PageInstance): void {
    this.setData({ editing: false, notice: '' });
  },

  onEditInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    const field = String(event.currentTarget.dataset.field ?? '');
    const value = String(event.detail.value ?? '');
    if (field === 'editName') {
      this.setData({ editName: value });
    } else if (field === 'editHeadline') {
      this.setData({ editHeadline: value });
    } else if (field === 'editBio') {
      this.setData({ editBio: value });
    } else if (field === 'editCity') {
      this.setData({ editCity: value });
    }
  },

  onToggleEditCapability(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const type = String(event.currentTarget.dataset.type ?? '') as CapabilityTypeName;
    this.setData({
      editCapabilities: this.data.editCapabilities.map((capability) =>
        capability.type === type ? { ...capability, on: !capability.on } : capability,
      ),
    });
  },

  async onSaveEdit(this: PageInstance): Promise<void> {
    this.setData({ acting: true, notice: '' });
    try {
      // A replacement: what the form leaves empty is cleared server-side.
      const desk = await replaceProfile(this.context, {
        publicName: this.data.editName,
        headline: this.data.editHeadline,
        bio: this.data.editBio,
        cityCode: this.data.editCity,
        capabilityTypes: this.data.editCapabilities
          .filter((capability) => capability.on)
          .map((capability) => capability.type),
      });
      this.setData({ acting: false, desk, editing: false });
      showToast('资料已更新。');
    } catch (error) {
      if (error instanceof ApplicationInvalidError) {
        this.setData({
          acting: false,
          notice: APPLICATION_PROBLEM_TEXTS[error.problems[0] ?? 'NO_PUBLIC_NAME'],
        });
        return;
      }
      this.setData({ acting: false, notice: errorMessageOf(error) });
    }
  },

  onToggleCapability(this: PageInstance, event: WechatMiniprogram.TouchEvent): void {
    const type = String(event.currentTarget.dataset.type ?? '') as CapabilityTypeName;
    const capabilities = this.data.capabilities.map((capability) =>
      capability.type === type ? { ...capability, on: !capability.on } : capability,
    );
    this.setData({ capabilities });
  },

  async onApply(this: PageInstance): Promise<void> {
    this.setData({ acting: true, notice: '' });
    try {
      const desk = await applyAsProvider(this.context, {
        publicName: this.data.publicName,
        headline: this.data.headline,
        bio: this.data.bio,
        cityCode: this.data.cityCode,
        capabilityTypes: this.data.capabilities.filter((item) => item.on).map((item) => item.type),
      });
      this.setData({ acting: false, desk, hasProvider: true });
      showToast('申请已创建。');
    } catch (error) {
      if (error instanceof ApplicationInvalidError) {
        this.setData({
          acting: false,
          notice: APPLICATION_PROBLEM_TEXTS[error.problems[0] ?? 'NO_PUBLIC_NAME'],
        });
        return;
      }
      this.setData({ acting: false, error: errorMessageOf(error) });
    }
  },

  async onSubmitForReview(this: PageInstance): Promise<void> {
    const agreed = await confirm({
      title: '提交审核',
      content: '提交后由平台审核，审核通过才能发布服务。',
    });
    if (!agreed) {
      return;
    }

    this.setData({ acting: true, notice: '' });
    try {
      const desk = await submitApplication(this.context);
      this.setData({ acting: false, desk });
      showToast('已提交审核。');
    } catch (error) {
      // PROVIDER_NOT_APPROVED and friends: the state is the answer.
      this.setData({ acting: false, notice: errorMessageOf(error) });
    }
  },

  onOpenVerification(this: PageInstance): void {
    navigateTo('/pages/provider-verification/provider-verification');
  },

  onOpenServices(this: PageInstance): void {
    navigateTo('/pages/provider-services/provider-services');
  },

  onOpenSlots(this: PageInstance): void {
    if (this.data.desk === null) {
      return;
    }
    navigateTo(
      `/pages/provider-slots/provider-slots?providerId=${encodeURIComponent(this.data.desk.id)}`,
    );
  },

  onOpenOrders(this: PageInstance): void {
    navigateTo('/pages/provider-orders/provider-orders');
  },

  onOpenReviews(this: PageInstance): void {
    if (this.data.desk === null) {
      return;
    }
    // The public list: a hidden review is hidden here too (FE-45).
    navigateTo(
      `/pages/provider-reviews/provider-reviews?providerId=${encodeURIComponent(this.data.desk.id)}`,
    );
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },
};

Page<ProviderDeskData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderDeskData,
    { context: MentorContext }
  >,
);
