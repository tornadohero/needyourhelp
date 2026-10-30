import type { MentorContext } from '../app-context';
import { currentUser } from './auth';
import { readiness } from './discovery';
import { providerReviews, searchProviders } from './discovery';
import { describeOrder } from '../core/order-view';
import { buildToDo, buildToday, whenText } from '../core/home';
import type { HomeOrderLike, HomeRole, NextActionView } from '../core/home';
import {
  LAST_FILTER_KEY,
  buildChildProgress,
  buildCompliance,
  buildDeskHealth,
  buildPendingReviews,
  buildReputation,
  isThisWeek,
} from '../core/insights';
import type {
  ChildProgressView,
  ComplianceView,
  ContinueSearchView,
  DeskHealthView,
  PendingReviewView,
  ReputationView,
  WeeklyView,
} from '../core/insights';
import { filterSummary, normalizeFilter } from '../core/filters';
import type { ProviderFilter } from '../core/filters';
import { describeSearchItem } from '../core/provider-view';
import type { ProviderRowView } from '../core/provider-view';
import { readStored } from '../platform/wechat';
import { ROUTES, fillPath } from '../core/routes';
import { listOrders } from './orders';
import { listChildren } from './profile';
import { listMyServices, myProviderProfile, myVerification } from './provider-desk';
import type {
  ConversationListResponse,
  OrderResponse,
  ReviewListResponse,
} from '@mentor/api-contracts';

/**
 * Home use cases.
 *
 * One round of orders answers both sides: the same list holds what I bought and
 * what I have to deliver, and the role only decides which cards are mine. The
 * provider profile is a separate call that may refuse — not being a mentor is
 * an answer, not an error to hide.
 *
 * The insights below are optional: each one is fetched on its own and answers
 * an empty result rather than failing the page, because a home that shows the
 * to-do list is still useful when the reputation call is down.
 */
export interface HomeView {
  displayName: string;
  role: HomeRole;
  desk: {
    id: string;
    publicName: string;
    approved: boolean;
    searchable: boolean;
    ratingText: string;
  } | null;
  parentToDo: NextActionView[];
  providerToDo: NextActionView[];
  today: NextActionView[];
  conversations: number;
  database: 'up' | 'down' | 'unknown';

  // P1
  continueSearch: (ContinueSearchView & { providers: ProviderRowView[] }) | null;
  pendingReviews: PendingReviewView[];
  reputation: ReputationView | null;
  deskHealth: DeskHealthView | null;

  // P2
  children: ChildProgressView[];
  weekly: WeeklyView;
  compliance: ComplianceView | null;
}

/** The approval label the health card shows; the desk view already has it. */
function profileApprovalText(desk: { approved: boolean }): string {
  return desk.approved ? '已通过审核' : '待审核';
}

function toHomeOrder(order: OrderResponse): HomeOrderLike {
  const row = describeOrder(order);
  return {
    id: row.id,
    status: order.status,
    statusText: row.statusText,
    title: row.title,
    timeText: row.timeText,
    scheduledStart: order.scheduledStart,
    providerId: order.providerId,
  };
}

export async function loadHome(context: MentorContext): Promise<HomeView> {
  const me = await currentUser(context);

  const [orders, ready, conversations] = await Promise.all([
    listOrders(context, { page: 1, pageSize: 20 }),
    readiness(context).catch(() => ({ database: 'unknown' as const })),
    countConversations(context).catch(() => 0),
  ]);

  let desk: HomeView['desk'] = null;
  try {
    const profile = await myProviderProfile(context);
    desk = {
      id: profile.id,
      publicName: profile.name,
      approved: profile.approvalStatus === 'APPROVED',
      searchable: profile.searchableText.includes('可'),
      ratingText: profile.ratingText,
    };
  } catch {
    // Not a mentor yet: the home still works, and the desk entry leads to
    // applying (T032).
  }

  const home = orders.items.map(toHomeOrder);
  const mine = desk === null ? home : home.filter((order) => order.providerId !== desk.id);
  const toDeliver = desk === null ? [] : home.filter((order) => order.providerId === desk.id);

  const [continueSearch, pendingReviews, children, deskHealth, reputation, compliance] =
    await Promise.all([
      loadContinueSearch(context),
      loadPendingReviews(context, orders.items),
      loadChildren(context, orders.items),
      desk === null
        ? Promise.resolve(null)
        : loadDeskHealth(context, { ...desk, approvalText: profileApprovalText(desk) }),
      desk === null ? Promise.resolve(null) : loadReputation(context, desk.id, desk.ratingText),
      desk === null ? Promise.resolve(null) : loadCompliance(context),
    ]);

  const completedThisWeek = orders.items
    .filter(
      (order) =>
        order.status === 'COMPLETED' &&
        order.scheduledEnd !== null &&
        isThisWeek(new Date(order.scheduledEnd)),
    )
    .filter((order) => desk === null || order.providerId === desk.id).length;

  return {
    displayName: me.displayName,
    // A mentor who also books lessons still lands on the parent view: buying is
    // the common case, and the switch is one tap away.
    role: 'parent',
    desk,
    parentToDo: buildToDo(mine, 'parent'),
    providerToDo: buildToDo(toDeliver, 'provider'),
    today: buildToday(toDeliver),
    conversations,
    database: ready.database,
    continueSearch,
    pendingReviews,
    reputation,
    deskHealth,
    children,
    weekly: { completedThisWeek },
    compliance,
  };
}

/** Just the count: the tab itself is where a thread is opened. */
async function countConversations(context: MentorContext): Promise<number> {
  return context.session.withSession(async (accessToken) => {
    const page = await context.client.get<ConversationListResponse>(ROUTES.conversations, {
      accessToken,
      query: { page: 1, pageSize: 1 },
    });
    return page.total;
  });
}

/**
 * "继续找老师": the filter the user last applied, and who it finds now.
 *
 * The filter is remembered locally (it is a preference, not personal data), and
 * the suggestion is a server answer — the client never ranks anyone itself.
 */
async function loadContinueSearch(context: MentorContext): Promise<HomeView['continueSearch']> {
  const stored = readStored<Partial<ProviderFilter>>(LAST_FILTER_KEY);
  const filter = normalizeFilter(stored ?? {});
  const summary = filterSummary(filter);

  const page = await searchProviders(context, {
    filter,
    page: 1,
    pageSize: 3,
  }).catch(() => null);

  if (page === null) {
    return null;
  }

  return { summary, filter, providers: page.items.map(describeSearchItem) };
}

/** Completed lessons the parent has not rated yet. */
async function loadPendingReviews(
  context: MentorContext,
  orders: OrderResponse[],
): Promise<PendingReviewView[]> {
  const finished = orders.filter((order) => order.status === 'COMPLETED').slice(0, 3);

  const rows = await Promise.all(
    finished.map(async (order) => {
      const hasReview = await hasOrderReview(context, order.id).catch(() => true);
      return {
        id: order.id,
        title: describeOrder(order).title,
        whenText: whenText(order.scheduledStart),
        hasReview,
      };
    }),
  );

  return buildPendingReviews(rows);
}

async function hasOrderReview(context: MentorContext, orderId: string): Promise<boolean> {
  return context.session.withSession(async (accessToken) => {
    const page = await context.client.get<ReviewListResponse>(
      fillPath(ROUTES.orderReviews, { id: orderId }),
      { accessToken },
    );
    return page.total > 0;
  });
}

/** Per child: how many lessons are done, and the last one. */
async function loadChildren(
  context: MentorContext,
  orders: OrderResponse[],
): Promise<ChildProgressView[]> {
  const children = await listChildren(context).catch(() => []);
  if (children.length === 0) {
    return [];
  }

  return buildChildProgress(
    children.map((child) => ({ id: child.id, name: child.name })),
    orders.map((order) => ({
      childId: order.childId,
      status: order.status,
      title: describeOrder(order).title,
      at: order.scheduledEnd ?? order.createdAt,
    })),
  );
}

/** Can a parent find and book this mentor this week? */
async function loadDeskHealth(
  context: MentorContext,
  desk: { id: string; approved: boolean; searchable: boolean; approvalText: string },
): Promise<DeskHealthView> {
  const [services, slots] = await Promise.all([
    listMyServices(context).catch(() => []),
    listFutureSlots(context, desk.id).catch(() => []),
  ]);

  const weekFromNow = Date.now() + 7 * 24 * 60 * 60_000;
  const slotsNext7Days = slots.filter((slot) => {
    const at = new Date(slot.startAt).getTime();
    return at >= Date.now() && at <= weekFromNow && slot.statusText.includes('可约');
  }).length;

  return buildDeskHealth({
    approvalText: desk.approvalText,
    approved: desk.approved,
    searchable: desk.searchable,
    publishedServices: services.filter((service) => service.statusText.includes('发布')).length,
    slotsNext7Days,
  });
}

async function listFutureSlots(
  context: MentorContext,
  providerId: string,
): Promise<{ startAt: string; statusText: string }[]> {
  const list = await context.session.withSession((accessToken) =>
    context.client.get<{ items: { startAt: string; status: string }[] }>(
      fillPath(ROUTES.providerAvailability, { id: providerId }),
      { accessToken },
    ),
  );

  return list.items.map((slot) => ({
    startAt: slot.startAt,
    statusText: slot.status === 'OPEN' ? '可预约' : '已占用',
  }));
}

/** The mentor's own scoreboard: rating, count, and the last two words. */
async function loadReputation(
  context: MentorContext,
  providerId: string,
  ratingText: string,
): Promise<ReputationView> {
  const page = await providerReviews(context, providerId, { page: 1, pageSize: 3 }).catch(() => ({
    items: [],
    total: 0,
  }));

  return buildReputation({
    ratingText,
    reviewCount: page.total,
    latest: page.items.map((review) => ({ content: review.content })),
  });
}

/** Verification that is not approved is the alert that matters. */
async function loadCompliance(context: MentorContext): Promise<ComplianceView> {
  const rows = await myVerification(context).catch(() => []);
  return buildCompliance({
    verifications: rows.map((row) => ({
      typeText: row.typeText,
      statusText: row.statusText,
      approved: row.statusText.includes('通过'),
    })),
  });
}

/**
 * Rate a finished lesson.
 *
 * The rating is the only thing a review must have; the words are optional, and
 * an empty note is dropped rather than sent as a blank string.
 */
export async function submitReview(
  context: MentorContext,
  orderId: string,
  rating: number,
  content: string,
): Promise<void> {
  const note = content.trim();
  await context.session.withSession((accessToken) =>
    context.client.post<unknown>(fillPath(ROUTES.orderReviews, { id: orderId }), {
      accessToken,
      body: { rating, ...(note.length > 0 ? { content: note } : {}) },
    }),
  );
}
