import type { MeResponse } from '@mentor/api-contracts';

import type { MentorContext } from '../app-context';
import { SessionExpiredError } from '../core/session';
import { ROUTES } from '../core/routes';

/**
 * Authentication use cases (T028).
 *
 * Identity is decided by the server: the client hands over a `wx.login()` code
 * and receives whatever account the platform says the code belongs to. Nothing
 * here asks for a role (`specs/07-permission-spec.md`, `AGENTS.md` §7).
 */

/**
 * `GET /me` is the contract's own payload: the account is whatever the server
 * says it is, including its status and roles. Nothing is narrowed or widened
 * here (`AGENTS.md` §10: clients use the contract types).
 */
export type CurrentUser = MeResponse;

export type SessionState = 'unknown' | 'signing-in' | 'signed-in' | 'needs-login' | 'error';

/**
 * Sign in unless there already is a session.
 *
 * Returns the state a screen should render; it never throws for an expected
 * outcome, because "not signed in yet" is a screen, not a crash.
 */
export async function ensureSession(context: MentorContext): Promise<SessionState> {
  if (context.session.isSignedIn) {
    return 'signed-in';
  }

  try {
    const code = await loginCode();
    await context.session.loginWithCode(code);
    return 'signed-in';
  } catch {
    return 'needs-login';
  }
}

/**
 * The WeChat `wx.login()` code.
 *
 * Kept behind a function so tests can stub it and so there is exactly one place
 * that touches `wx`.
 */
let codeProvider: () => Promise<string> = async () => {
  const { fetchLoginCode } = await import('../platform/wechat');
  return fetchLoginCode();
};

export function setLoginCodeProvider(provider: () => Promise<string>): void {
  codeProvider = provider;
}

function loginCode(): Promise<string> {
  return codeProvider();
}

/** `GET /me`: the account as the server sees it, roles included. */
export async function currentUser(context: MentorContext): Promise<CurrentUser> {
  return context.session.withSession((accessToken) =>
    context.client.get<CurrentUser>(ROUTES.me, { accessToken }),
  );
}

/** End the session. A refused call still clears the local session. */
export async function signOut(context: MentorContext): Promise<SessionState> {
  await context.session.logout();
  return 'needs-login';
}

export { SessionExpiredError };
