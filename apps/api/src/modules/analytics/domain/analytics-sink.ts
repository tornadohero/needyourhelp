import type { AnalyticsEvent } from './analytics-event.model';

/** Dependency-injection token for {@link AnalyticsSink}. */
export const ANALYTICS_SINK = 'ANALYTICS_SINK';

/**
 * Where events go.
 *
 * The platform does not own an analytics store in V1: the adapter writes
 * structured logs, which a pipeline outside the service turns into the metrics
 * of `specs/15` (`specs/03-architecture-spec.md` §Observability).
 */
export interface AnalyticsSink {
  record(event: AnalyticsEvent): Promise<void>;
}
