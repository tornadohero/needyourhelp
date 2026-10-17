/**
 * Analytics vocabulary (T020).
 *
 * Source of truth: `specs/15-analytics-spec.md`. Events carry minimal personal
 * data, and a child's name or identity is never a dimension
 * (`specs/10-privacy-and-minors.md` §Child profile rules).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Parent funnel (`specs/15-analytics-spec.md` §Funnel). */
export const PARENT_FUNNEL_EVENTS = [
  'home_viewed',
  'search_started',
  'provider_list_viewed',
  'provider_detail_viewed',
  'chat_started',
  'booking_started',
  'order_created',
  'payment_started',
  'payment_succeeded',
  'order_completed',
  'review_submitted',
] as const;
export type ParentFunnelEventName = (typeof PARENT_FUNNEL_EVENTS)[number];

/** Provider funnel (`specs/15-analytics-spec.md` §Funnel). */
export const PROVIDER_FUNNEL_EVENTS = [
  'application_started',
  'application_submitted',
  'verification_submitted',
  'provider_approved',
  'service_published',
  'inquiry_received',
  'order_received',
  'order_completed',
] as const;
export type ProviderFunnelEventName = (typeof PROVIDER_FUNNEL_EVENTS)[number];

/**
 * Every event name the platform knows.
 *
 * `order_completed` belongs to both funnels: one delivery is the end of the
 * parent's path and of the provider's.
 */
export const ANALYTICS_EVENT_NAMES = [
  ...new Set([...PARENT_FUNNEL_EVENTS, ...PROVIDER_FUNNEL_EVENTS]),
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/**
 * Which funnel an event belongs to, for a metric to be computed on the right
 * population.
 */
export const ANALYTICS_FUNNELS = ['parent', 'provider'] as const;
export type AnalyticsFunnelName = (typeof ANALYTICS_FUNNELS)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * An analytics event as it leaves the platform.
 *
 * Deliberately absent: any child identifier, every name, contact detail and
 * document reference (`specs/15`: "Track events with minimal personal data").
 */
export interface AnalyticsEventResponse {
  name: AnalyticsEventName;
  funnel: AnalyticsFunnelName;
  /** Keyed hash of the acting account; never the raw user id. */
  actorIdHash: string | null;
  /** Ids of the objects involved: opaque, never personal. */
  subject: {
    providerId: string | null;
    serviceId: string | null;
    orderId: string | null;
    conversationId: string | null;
  };
  /** Flat, primitive, bounded dimensions. */
  props: Record<string, string | number | boolean | null>;
  occurredAt: string;
}
