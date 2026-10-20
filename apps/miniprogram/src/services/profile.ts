import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import { describeConsents } from '../core/consents';
import type { ConsentView } from '../core/consents';
import type {
  ConsentTypeName,
  ConsentListResponse,
  ParentProfileResponse,
  ProfileResponse,
} from '@mentor/api-contracts';

/**
 * Account, profile and consent use cases (T029).
 *
 * Every call goes through the session: the account is whoever the token says it
 * is. Nothing here sends a user id, a role or a status — the server refuses
 * them, and the client does not try (`AGENTS.md` §7, `specs/07`).
 */

export interface ProfileView {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  cityCode: string | null;
  timezone: string;
  /** `null` until the account fills in guardian details. */
  hasGuardianDetails: boolean;
}

export interface ProfileUpdate {
  displayName?: string;
  avatarUrl?: string;
  cityCode?: string;
  timezone?: string;
}

export function toProfileView(profile: ProfileResponse): ProfileView {
  const parent: ParentProfileResponse | null = profile.parentProfile;
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    cityCode: parent?.cityCode ?? null,
    timezone: parent?.timezone ?? 'Asia/Shanghai',
    hasGuardianDetails: parent !== null,
  };
}

/** `GET /me/profile`. */
export async function getProfile(context: MentorContext): Promise<ProfileView> {
  const profile = await context.session.withSession((accessToken) =>
    context.client.get<ProfileResponse>(ROUTES.meProfile, { accessToken }),
  );
  return toProfileView(profile);
}

/**
 * `PUT /me/profile`.
 *
 * Only display fields are sent: name, avatar, city and timezone. A role, a status
 * or a user id would be rejected by the server's whitelist anyway.
 */
export async function updateProfile(
  context: MentorContext,
  update: ProfileUpdate,
): Promise<ProfileView> {
  const profile = await context.session.withSession((accessToken) =>
    context.client.put<ProfileResponse>(ROUTES.meProfile, { accessToken, body: update }),
  );
  return toProfileView(profile);
}

/** `GET /me/consents`: the consent history, newest first. */
export async function listConsents(context: MentorContext): Promise<ConsentView[]> {
  const list = await context.session.withSession((accessToken) =>
    context.client.get<ConsentListResponse>(ROUTES.meConsents, { accessToken }),
  );
  return describeConsents(list);
}

/** `POST /me/consents`: grant one, recording the policy version shown to the user. */
export async function grantConsent(
  context: MentorContext,
  input: { consentType: ConsentTypeName; policyVersion: string },
): Promise<void> {
  await context.session.withSession((accessToken) =>
    context.client.post(ROUTES.meConsents, { accessToken, body: input }),
  );
}

/**
 * `DELETE /me/consents/:consentType`: withdraw one.
 *
 * Withdrawal is a right, not a setting: it must always be reachable
 * (`specs/10-privacy-and-minors.md` §consent withdrawal).
 */
export async function revokeConsent(
  context: MentorContext,
  consentType: ConsentTypeName,
): Promise<void> {
  await context.session.withSession((accessToken) =>
    context.client.delete(fillPath(ROUTES.meConsent, { consentType }), { accessToken }),
  );
}
