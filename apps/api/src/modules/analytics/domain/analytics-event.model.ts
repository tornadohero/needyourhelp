import type { AnalyticsEventName, AnalyticsFunnelName } from '@mentor/api-contracts';

/** A flat, primitive dimension set: what an event may carry. */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

/**
 * Domain view of an analytics event (`specs/15-analytics-spec.md`).
 *
 * An event describes what happened to which object, never who a person is:
 * the acting account is a keyed hash, and the props are flat primitives that
 * the policy has already cleared of personal data.
 */
export interface AnalyticsEvent {
  name: AnalyticsEventName;
  funnel: AnalyticsFunnelName;
  actorIdHash: string | null;
  subject: {
    providerId: string | null;
    serviceId: string | null;
    orderId: string | null;
    conversationId: string | null;
  };
  props: AnalyticsProps;
  occurredAt: Date;
}

/** What a caller of {@link AnalyticsService.track} supplies. */
export interface TrackEventInput {
  name: AnalyticsEventName;
  /** Raw account id: hashed before the event leaves the process. */
  actorUserId?: string | null;
  providerId?: string | null;
  serviceId?: string | null;
  orderId?: string | null;
  conversationId?: string | null;
  props?: AnalyticsProps;
}

/**
 * `hasChild` and nothing else: a booking may be for a child, but the child's
 * name, identity or profile is never a dimension
 * (`specs/15`: "Do not use child name/identity as analytics dimensions").
 */
export function childPresence(childId: string | null | undefined): { has_child: boolean } {
  return { has_child: childId !== null && childId !== undefined };
}
