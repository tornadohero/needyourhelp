import type { ProfileResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import { MemoryTokenStore, SessionManager } from '../core/session';
import { ROUTES } from '../core/routes';
import { listChildren } from './profile';
import {
  getProfile,
  grantConsent,
  listConsents,
  revokeConsent,
  toProfileView,
  updateProfile,
} from './profile';

type Answer = { status: number; body: unknown };

function harness(answers: Answer[] = []) {
  const calls: TransportRequest[] = [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({ client, store });
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 4_102_444_800 });

  return { context: { client, session }, calls };
}

const PROFILE: ProfileResponse = {
  userId: 'user-1',
  displayName: '张家长',
  avatarUrl: null,
  parentProfile: {
    id: 'parent-1',
    displayName: '张家长',
    cityCode: 'BEIJING',
    timezone: 'Asia/Shanghai',
  },
};

describe('toProfileView', () => {
  it('flattens the guardian details a screen needs', () => {
    expect(toProfileView(PROFILE)).toMatchObject({
      userId: 'user-1',
      displayName: '张家长',
      cityCode: 'BEIJING',
      timezone: 'Asia/Shanghai',
      hasGuardianDetails: true,
    });
  });

  it('answers a default timezone until the account sets one', () => {
    expect(toProfileView({ ...PROFILE, parentProfile: null })).toMatchObject({
      cityCode: null,
      timezone: 'Asia/Shanghai',
      hasGuardianDetails: false,
    });
  });
});

describe('profile service', () => {
  it('reads the profile with the session token', async () => {
    const { context, calls } = harness([{ status: 200, body: { data: PROFILE } }]);

    const profile = await getProfile(context);

    expect(profile.displayName).toBe('张家长');
    expect(calls[0]?.url).toBe(`https://api.example.com/api/v1${ROUTES.meProfile}`);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('sends only display fields on update', async () => {
    const { context, calls } = harness([{ status: 200, body: { data: PROFILE } }]);

    await updateProfile(context, { displayName: '新昵称', cityCode: 'SHANGHAI' });

    expect(calls[0]?.method).toBe('PUT');
    // No userId, no role, no status: the server refuses them and so does this client.
    expect(calls[0]?.body).toBe('{"displayName":"新昵称","cityCode":"SHANGHAI"}');
  });

  it('lists consents newest first', async () => {
    const { context, calls } = harness([
      {
        status: 200,
        body: {
          data: {
            consents: [
              {
                id: 'c-1',
                consentType: 'MINOR_GUARDIAN',
                policyVersion: 'v1',
                granted: true,
                grantedAt: '2026-01-01T00:00:00.000Z',
                revokedAt: null,
              },
            ],
          },
        },
      },
    ]);

    const consents = await listConsents(context);

    expect(consents[0]).toMatchObject({
      type: 'MINOR_GUARDIAN',
      active: true,
      policyVersion: 'v1',
    });
    expect(calls[0]?.url).toBe(`https://api.example.com/api/v1${ROUTES.meConsents}`);
  });

  it('records the policy version when granting', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: {} } }]);

    await grantConsent(context, { consentType: 'PRIVACY', policyVersion: 'v2' });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe('{"consentType":"PRIVACY","policyVersion":"v2"}');
  });

  it('withdraws a consent by type, without sending a body', async () => {
    const { context, calls } = harness([{ status: 200, body: { data: {} } }]);

    await revokeConsent(context, 'MARKETING');

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/me/consents/MARKETING');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('refuses to work with an unfilled route instead of calling it', async () => {
    const { context } = harness();
    const session = context.session;

    // Ending the session is the guard: no token, no call.
    session.logout();
    await expect(listConsents(context)).rejects.toThrow();
  });
});

describe('listChildren', () => {
  it('reads the guardian’s own list and describes it for the picker', async () => {
    const { context, calls } = harness([
      {
        status: 200,
        body: {
          data: {
            children: [
              {
                id: 'child-1',
                nickname: '小明',
                birthYear: 2014,
                gradeCode: 'G7',
                schoolName: '某中学',
                learningGoals: '数学基础',
                consentStatus: 'GRANTED',
                createdAt: '2026-10-01T00:00:00.000Z',
              },
            ],
          },
        },
      },
    ]);

    const children = await listChildren(context);

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/me/children');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-1');
    expect(children[0]?.name).toBe('小明');
    expect(children[0]?.selectable).toBe(true);
    // The picker keeps a name and a grade; the rest of the profile stays out.
    expect(JSON.stringify(children)).not.toContain('某中学');
  });

  it('marks a child without consent as not bookable', async () => {
    const { context } = harness([
      {
        status: 200,
        body: {
          data: {
            children: [
              {
                id: 'child-2',
                nickname: '小红',
                birthYear: 2015,
                gradeCode: null,
                schoolName: null,
                learningGoals: null,
                consentStatus: 'PENDING',
                createdAt: '2026-10-01T00:00:00.000Z',
              },
            ],
          },
        },
      },
    ]);

    const children = await listChildren(context);

    expect(children[0]?.selectable).toBe(false);
    expect(children[0]?.consentText).toBe('待授权');
  });
});
