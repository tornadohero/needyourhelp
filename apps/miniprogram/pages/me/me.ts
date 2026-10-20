import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import { describeAccount } from '../../src/core/account';
import type { AccountView } from '../../src/core/account';
import type { ConsentTypeName } from '@mentor/api-contracts';
import { errorMessageOf } from '../../src/core/errors';
import { currentUser, ensureSession, signOut } from '../../src/services/auth';
import type { SessionState } from '../../src/services/auth';
import { getProfile, listConsents, revokeConsent, updateProfile } from '../../src/services/profile';
import type { ProfileView } from '../../src/services/profile';
import type { ConsentView } from '../../src/core/consents';

/**
 * 我的 / 隐私与设置（T029）— `specs/11` §Parent pages.
 *
 * What this screen is responsible for:
 * - show the account as the server describes it, including a suspended state;
 * - edit display fields only (name, avatar, city, timezone);
 * - show the consent history and let the user withdraw a consent.
 *
 * What it never does: decide roles or permissions locally, send a user id, or
 * hide a withdrawal behind a toggle the server does not know about
 * (`specs/07`, `specs/10`).
 */
interface MeData {
  loading: boolean;
  error: string;
  sessionState: SessionState;
  account: AccountView | null;
  profile: ProfileView | null;
  consents: ConsentView[];
  editing: boolean;
  draftName: string;
  draftCity: string;
  busy: boolean;
  notice: string;
}

type PageInstance = WechatMiniprogram.Page.Instance<MeData, { context: MentorContext }> & {
  load(): Promise<void>;
};

const pageOptions = {
  data: {
    loading: true,
    error: '',
    sessionState: 'unknown' as SessionState,
    account: null as AccountView | null,
    profile: null as ProfileView | null,
    consents: [] as ConsentView[],
    editing: false,
    draftName: '',
    draftCity: '',
    busy: false,
    notice: '',
  },

  context: ensureContext(),

  async onShow(this: PageInstance): Promise<void> {
    await this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '', notice: '' });

    const sessionState = await ensureSession(this.context);
    this.setData({ sessionState });

    if (sessionState !== 'signed-in') {
      this.setData({ loading: false, account: null, profile: null, consents: [] });
      return;
    }

    try {
      const [me, profile, consents] = await Promise.all([
        currentUser(this.context),
        getProfile(this.context),
        listConsents(this.context),
      ]);
      this.setData({
        loading: false,
        account: describeAccount(me),
        profile,
        consents,
        draftName: profile.displayName,
        draftCity: profile.cityCode ?? '',
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },

  onEdit(this: PageInstance): void {
    this.setData({ editing: true });
  },

  onCancelEdit(this: PageInstance): void {
    const profile = this.data.profile;
    this.setData({
      editing: false,
      draftName: profile?.displayName ?? '',
      draftCity: profile?.cityCode ?? '',
    });
  },

  onNameInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draftName: String(event.detail.value ?? '') });
  },

  onCityInput(this: PageInstance, event: WechatMiniprogram.Input): void {
    this.setData({ draftCity: String(event.detail.value ?? '') });
  },

  async onSave(this: PageInstance): Promise<void> {
    const name = this.data.draftName.trim();
    if (name.length === 0) {
      this.setData({ error: '昵称不能为空。' });
      return;
    }

    this.setData({ busy: true, error: '', notice: '' });
    try {
      // Only display fields: the server decides everything else.
      const profile = await updateProfile(this.context, {
        displayName: name,
        ...(this.data.draftCity.trim().length > 0 ? { cityCode: this.data.draftCity.trim() } : {}),
      });
      this.setData({ busy: false, editing: false, profile, notice: '已保存。' });
    } catch (error) {
      this.setData({ busy: false, error: errorMessageOf(error) });
    }
  },

  /**
   * Withdraw a consent.
   *
   * Confirmed first: withdrawal is easy to trigger and hard to undo
   * (`specs/10` §consent withdrawal), so it is never a single tap.
   */
  async onRevokeConsent(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const type = String(event.currentTarget.dataset.type ?? '') as ConsentTypeName;
    if (type.length === 0) {
      return;
    }

    const confirmed = await confirmRevoke();
    if (!confirmed) {
      return;
    }

    this.setData({ busy: true, error: '', notice: '' });
    try {
      await revokeConsent(this.context, type);
      const consents = await listConsents(this.context);
      this.setData({ busy: false, consents, notice: '已撤回该同意。' });
    } catch (error) {
      this.setData({ busy: false, error: errorMessageOf(error) });
    }
  },

  async onSignOut(this: PageInstance): Promise<void> {
    this.setData({ busy: true });
    const sessionState = await signOut(this.context);
    this.setData({
      busy: false,
      sessionState,
      account: null,
      profile: null,
      consents: [],
      notice: '已退出登录。',
    });
  },
};

// The WeChat typings only describe lifecycle methods; the handlers above are ours.
Page<MeData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<MeData, { context: MentorContext }>,
);

function confirmRevoke(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '撤回同意',
      content: '撤回后将不再处理对应信息，部分功能可能不可用。确定撤回吗？',
      success: (result: { confirm?: boolean }) => resolve(result.confirm === true),
      fail: () => resolve(false),
    });
  });
}
