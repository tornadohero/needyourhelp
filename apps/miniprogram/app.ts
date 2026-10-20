import { ensureContext } from './src/app-context';
import { ensureSession } from './src/services/auth';
import type { SessionState } from './src/services/auth';

/**
 * App bootstrap (T028).
 *
 * The mini program has no login screen: `wx.login()` runs on launch, the code is
 * exchanged once, and every screen reads the session from the shared context.
 * Nothing here decides who the user is — that is the server's answer
 * (`specs/07-permission-spec.md`, `AGENTS.md` §7).
 */
type AppGlobalData = { globalData: { sessionState: SessionState } };

const appOptions = {
  globalData: {
    sessionState: 'unknown',
  },

  onLaunch(this: { globalData: { sessionState: SessionState }; bootstrap(): Promise<void> }) {
    void this.bootstrap();
  },

  async bootstrap(this: { globalData: { sessionState: SessionState } }): Promise<void> {
    this.globalData.sessionState = 'signing-in';
    this.globalData.sessionState = await ensureSession(ensureContext());
  },
};

// The WeChat typings only describe lifecycle methods; `bootstrap` is ours.
App<AppGlobalData>(appOptions as unknown as WechatMiniprogram.App.Options<AppGlobalData>);
