import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import { appendPage, hasMore, initialList, nextPage } from '../core/paging';
import type { ListState } from '../core/paging';
import { normalizeFilter, toSearchQuery } from '../core/filters';
import type { ProviderFilter } from '../core/filters';
import {
  describeProviderDetail,
  describeReview,
  describeSearchItem,
  describeSlot,
} from '../core/provider-view';
import type {
  ProviderDetailView,
  ProviderRowView,
  ReviewRowView,
  SlotRowView,
} from '../core/provider-view';
import type {
  AvailabilityListResponse,
  ProviderDetailResponse,
  ProviderReviewListResponse,
  ProviderSearchItemResponse,
  ProviderSearchResponse,
} from '@mentor/api-contracts';

/**
 * Discovery use cases (T030) — the read side of "find a tutor".
 *
 * Every payload is the public, allowlisted DTO: no owner user id, no approval
 * status, no `searchable`, no internal capability state, and no child data ever
 * comes through here (`specs/07-permission-spec.md`, `specs/10`).
 */

export interface ProviderPage {
  items: ProviderSearchItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * `GET /providers` — public, bounded, and filtered only by fields the API
 * documents. The filter is normalised here so a screen cannot send a value the
 * server would refuse.
 */
export async function searchProviders(
  context: MentorContext,
  options: { filter?: Partial<ProviderFilter>; page?: number; pageSize?: number } = {},
): Promise<ProviderPage> {
  const query = toSearchQuery(normalizeFilter(options.filter));

  return context.client.get<ProviderSearchResponse>(ROUTES.providers, {
    query: { ...query, page: options.page ?? 1, pageSize: options.pageSize ?? 20 },
  });
}

/** First page of a list, as a view-model list a screen can render. */
export async function loadProviders(
  context: MentorContext,
  options: { filter?: Partial<ProviderFilter>; pageSize?: number } = {},
): Promise<ListState<ProviderRowView>> {
  const page = await searchProviders(context, { ...options, page: 1 });
  const state = initialList<ProviderRowView>(page.pageSize);
  return appendPage(state, {
    items: page.items.map(describeSearchItem),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  });
}

/**
 * The next page, or the same list when it is already complete.
 *
 * Returns `null` when there is nothing more to fetch, so a screen can stop
 * asking instead of looping on a short page.
 */
export async function loadMoreProviders(
  context: MentorContext,
  state: ListState<ProviderRowView>,
  options: { filter?: Partial<ProviderFilter> } = {},
): Promise<{ state: ListState<ProviderRowView>; loaded: boolean }> {
  const page = nextPage(state);
  if (page === null) {
    return { state, loaded: false };
  }

  const result = await searchProviders(context, { ...options, page, pageSize: state.pageSize });
  const next = appendPage(state, {
    items: result.items.map(describeSearchItem),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });

  return { state: next, loaded: true };
}

export function canLoadMore(state: ListState<ProviderRowView>): boolean {
  return hasMore(state);
}

/** `GET /providers/:id` — the public profile plus its published services. */
export async function providerDetail(
  context: MentorContext,
  providerId: string,
): Promise<ProviderDetailView> {
  const detail = await context.client.get<ProviderDetailResponse>(
    fillPath(ROUTES.providerDetail, { id: providerId }),
  );
  return describeProviderDetail(detail);
}

/** `GET /providers/:id/reviews` — public, paginated. */
export async function providerReviews(
  context: MentorContext,
  providerId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<{ items: ReviewRowView[]; total: number }> {
  const page = await context.client.get<ProviderReviewListResponse>(
    fillPath(ROUTES.providerReviews, { id: providerId }),
    { query: options },
  );
  return { items: page.items.map(describeReview), total: page.total };
}

/** `GET /providers/:id/availability` — bookable windows only. */
export async function providerAvailability(
  context: MentorContext,
  providerId: string,
): Promise<{ items: SlotRowView[]; total: number }> {
  const page = await context.client.get<AvailabilityListResponse>(
    fillPath(ROUTES.providerAvailability, { id: providerId }),
  );
  return { items: page.items.map(describeSlot), total: page.total };
}

/**
 * Everything a detail screen needs, in one call.
 *
 * The four requests are independent reads; one failing (for example a provider
 * with no slots yet) must not hide the rest, so they are settled individually.
 */
export async function loadProviderDetail(
  context: MentorContext,
  providerId: string,
): Promise<{
  provider: ProviderDetailView;
  reviews: ReviewRowView[];
  slots: SlotRowView[];
}> {
  const [provider, reviews, slots] = await Promise.all([
    providerDetail(context, providerId),
    providerReviews(context, providerId, { pageSize: 10 }),
    providerAvailability(context, providerId),
  ]);

  return { provider, reviews: reviews.items, slots: slots.items };
}

/** `GET /health/ready` — what a support or offline screen shows. */
export async function readiness(context: MentorContext): Promise<{ database: 'up' | 'down' }> {
  return context.client.get<{ database: 'up' | 'down' }>(ROUTES.healthReady);
}
