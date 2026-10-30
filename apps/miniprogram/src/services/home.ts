import type { MentorContext } from '../app-context';
import { currentUser } from './auth';
import { readiness } from './discovery';
import { describeOrder } from '../core/order-view';
import { buildToDo, buildToday } from '../core/home';
import type { HomeOrderLike, HomeRole, NextActionView } from '../core/home';
import { ROUTES } from '../core/routes';
import { listOrders } from './orders';
import { myProviderProfile } from './provider-desk';
import type { ConversationListResponse, OrderResponse } from '@mentor/api-contracts';

/**
 * Home use cases (P0).
 *
 * One round of orders answers both sides: the same list holds what I bought and
 * what I have to deliver, and the role only decides which cards are mine. The
 * provider profile is a separate call that may refuse — not being a mentor is
 * an answer, not an error to hide.
 */
export interface HomeView {
  displayName: string;
  role: HomeRole;
  /** `null` when the account is not a mentor: being a parent is the default. */
  desk: { id: string; publicName: string } | null;
  parentToDo: NextActionView[];
  providerToDo: NextActionView[];
  today: NextActionView[];
  /** How many threads exist; the platform keeps no read cursor, so no badge. */
  conversations: number;
  database: 'up' | 'down' | 'unknown';
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
    countConversations(context),
  ]);

  let desk: HomeView['desk'] = null;
  try {
    const profile = await myProviderProfile(context);
    desk = { id: profile.id, publicName: profile.name };
  } catch {
    // Not a mentor yet: the home still works, and the desk entry leads to
    // applying (T032). A refusal is an answer, not a failure of the page.
  }

  const home = orders.items.map(toHomeOrder);
  const mine = home.filter((order) => order.providerId !== desk?.id || desk === null);
  const toDeliver = desk === null ? [] : home.filter((order) => order.providerId === desk.id);

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
