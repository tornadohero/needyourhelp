import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import { MemoryTokenStore, SessionManager } from '../core/session';
import {
  canLoadMore,
  loadMoreProviders,
  loadProviderDetail,
  loadProviders,
  searchProviders,
} from './discovery';

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

  return { context: { client, session }, calls };
}

const PROVIDER = {
  id: 'provider-1',
  providerType: 'TUTORING',
  publicName: '李老师',
  headline: null,
  bio: null,
  avatarAssetId: null,
  cityCode: 'BEIJING',
  serviceMode: 'ONLINE',
  ratingAvg: 4.5,
  ratingCount: 3,
  completedOrderCount: 7,
  capabilities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  minPriceMinor: 20_000,
};

function searchPage(ids: string[], total: number, page: number): Answer {
  return {
    status: 200,
    body: {
      data: {
        items: ids.map((id) => ({ ...PROVIDER, id })),
        total,
        page,
        pageSize: 20,
      },
    },
  };
}

describe('searchProviders', () => {
  it('asks for a bounded page with the normalised filters', async () => {
    const { context, calls } = harness([searchPage(['provider-1'], 1, 1)]);

    await searchProviders(context, { filter: { city: 'beijing', sort: 'rating' }, page: 2 });

    expect(calls[0]?.url).toBe(
      'https://api.example.com/api/v1/providers?domain=TUTORING&city=BEIJING&sort=rating&page=2&pageSize=20',
    );
  });

  it('sends no token: discovery is public', async () => {
    const { context, calls } = harness([searchPage(['provider-1'], 1, 1)]);

    await searchProviders(context);

    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });
});

describe('list paging', () => {
  it('loads the first page as rows a screen can render', async () => {
    const { context } = harness([searchPage(['provider-1', 'provider-2'], 5, 1)]);

    const state = await loadProviders(context);

    expect(state.items.map((row) => row.id)).toEqual(['provider-1', 'provider-2']);
    expect(state.total).toBe(5);
    expect(canLoadMore(state)).toBe(true);
  });

  it('appends the next page and stops when the list is complete', async () => {
    // Two rows in total, one per page: there is exactly one more page to fetch.
    const { context } = harness([
      searchPage(['provider-1'], 2, 1),
      searchPage(['provider-2'], 2, 2),
    ]);

    const first = await loadProviders(context);
    const { state: second, loaded } = await loadMoreProviders(context, first);

    expect(loaded).toBe(true);
    expect(second.items.map((row) => row.id)).toEqual(['provider-1', 'provider-2']);
    expect(canLoadMore(second)).toBe(false);

    // Nothing more to fetch: the screen stops asking instead of looping.
    const again = await loadMoreProviders(context, second);
    expect(again.loaded).toBe(false);
    expect(again.state).toBe(second);
  });
});

describe('loadProviderDetail', () => {
  it('joins profile, reviews and slots from their own endpoints', async () => {
    const { context, calls } = harness([
      {
        status: 200,
        body: {
          data: {
            ...PROVIDER,
            services: [
              {
                id: 'service-1',
                providerId: 'provider-1',
                domain: 'TUTORING',
                title: '数学一对一',
                description: null,
                durationMinutes: 60,
                priceMinor: 20_000,
                currency: 'CNY',
                deliveryMode: 'ONLINE',
                status: 'PUBLISHED',
                terms: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        },
      },
      { status: 200, body: { data: { items: [], total: 0, page: 1, pageSize: 10 } } },
      { status: 200, body: { data: { items: [], total: 0 } } },
    ]);

    const bundle = await loadProviderDetail(context, 'provider-1');

    expect(bundle.provider.serviceCount).toBe(1);
    expect(bundle.reviews).toEqual([]);
    expect(bundle.slots).toEqual([]);
    expect(calls.map((call) => call.url.split('/api/v1')[1])).toEqual([
      '/providers/provider-1',
      '/providers/provider-1/reviews?pageSize=10',
      '/providers/provider-1/availability',
    ]);
  });

  it('lets a failure surface instead of pretending the profile loaded', async () => {
    const { context } = harness([
      { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no' } } },
    ]);

    // NOT_FOUND and FORBIDDEN are indistinguishable to the client by design.
    await expect(loadProviderDetail(context, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
