import type { ProviderFilter } from './filters';

/**
 * Home insights (P1/P2) — the second screen of the home, for both sides.
 *
 * Everything here is derived from what the server already answered: no new
 * metric is invented, no money is summed client-side (G7 owns earnings), and
 * nothing about a child beyond a nickname and a count ever reaches a view
 * (`specs/10-privacy-and-minors.md`).
 */

/** Where the last search was left, so "继续找老师" is one tap. */
export const LAST_FILTER_KEY = 'mentor.last-filter';

export interface ContinueSearchView {
  summary: string[];
  filter: ProviderFilter;
}

/** The lesson is over, the words are not written yet. */
export interface PendingReviewView {
  orderId: string;
  title: string;
  whenText: string;
}

/** A child, as much as a home may show: a name, a count, a last subject. */
export interface ChildProgressView {
  id: string;
  name: string;
  lessonsDone: number;
  lastTitle: string;
}

/** Can a parent find and book this mentor right now? */
export interface DeskHealthView {
  approvalText: string;
  searchableText: string;
  publishedServices: number;
  slotsNext7Days: number;
  /** What to fix first, most important first. */
  warnings: string[];
}

export interface ReputationView {
  ratingText: string;
  reviewCount: number;
  latest: string[];
}

/** Orders finished this week — a count, never a sum (no earnings endpoint). */
export interface WeeklyView {
  completedThisWeek: number;
}

export interface ComplianceView {
  alerts: string[];
}

/**
 * Same calendar week as today, Monday-based, and never in the future.
 *
 * "本周完成" counts what already happened: a lesson scheduled for later in the
 * week is not done yet.
 */
export function isThisWeek(at: Date, now: Date = new Date()): boolean {
  const startOfWeek = new Date(now);
  const monday = (now.getDay() + 6) % 7;
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - monday);
  return at.getTime() >= startOfWeek.getTime() && at.getTime() <= now.getTime();
}

/**
 * Pick the orders that have no review yet.
 *
 * `reviewed` comes from the API, never from a guess: a parent is not nagged
 * about a lesson they already rated.
 */
export function buildPendingReviews(
  completed: { id: string; title: string; whenText: string; hasReview: boolean }[],
): PendingReviewView[] {
  return completed
    .filter((order) => !order.hasReview)
    .map((order) => ({ orderId: order.id, title: order.title, whenText: order.whenText }));
}

/**
 * What a child has done, counted from orders the server returned.
 *
 * The count and the last subject are the whole story on a home screen — no
 * grade, no school, no goals.
 */
export function buildChildProgress(
  children: { id: string; name: string }[],
  orders: { childId: string | null; status: string; title: string; at: string }[],
): ChildProgressView[] {
  return children.map((child) => {
    const done = orders
      .filter((order) => order.childId === child.id && order.status === 'COMPLETED')
      .sort((left, right) => right.at.localeCompare(left.at));

    return {
      id: child.id,
      name: child.name,
      lessonsDone: done.length,
      lastTitle: done[0]?.title ?? '',
    };
  });
}

/**
 * The mentor's discoverability check.
 *
 * Four facts a mentor cannot see anywhere else: am I approved, am I visible,
 * do I have something published, and can anyone actually book me this week.
 */
export function buildDeskHealth(input: {
  approvalText: string;
  approved: boolean;
  searchable: boolean;
  publishedServices: number;
  slotsNext7Days: number;
}): DeskHealthView {
  const warnings: string[] = [];

  if (!input.approved) {
    warnings.push('尚未通过审核，暂时无法被家长看到。');
  }
  if (input.publishedServices === 0) {
    warnings.push('还没有已发布的服务，家长无法下单。');
  }
  if (input.slotsNext7Days === 0) {
    warnings.push('未来 7 天没有可预约时段，建议补充。');
  }

  return {
    approvalText: input.approvalText,
    searchableText: input.searchable ? '可被搜索' : '暂不可搜',
    publishedServices: input.publishedServices,
    slotsNext7Days: input.slotsNext7Days,
    warnings,
  };
}

/** Reviews, cut to what a card can hold. */
export function buildReputation(input: {
  ratingText: string;
  reviewCount: number;
  latest: { content: string | null }[];
}): ReputationView {
  return {
    ratingText: input.ratingText,
    reviewCount: input.reviewCount,
    latest: input.latest
      .map((review) => review.content ?? '')
      .filter((content) => content.length > 0)
      .slice(0, 2),
  };
}

/** Verification that is not approved is the one compliance alert that matters. */
export function buildCompliance(input: {
  verifications: { typeText: string; statusText: string; approved: boolean }[];
}): ComplianceView {
  const alerts = input.verifications
    .filter((row) => !row.approved)
    .map((row) => `${row.typeText}：${row.statusText}`);

  // A standing rule, not a state: talking to a minor stays on the platform.
  alerts.push('与未成年学员的沟通请留在平台内。');

  return { alerts };
}
