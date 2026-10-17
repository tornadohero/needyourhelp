import { Injectable, Logger } from '@nestjs/common';

import type { AnalyticsEvent } from '../domain/analytics-event.model';
import type { AnalyticsSink } from '../domain/analytics-sink';

/**
 * Structured-log adapter for {@link AnalyticsSink}.
 *
 * V1 keeps no analytics table: events go out as one JSON line per event, which
 * is what `specs/03-architecture-spec.md` §Observability asks for and what an
 * external pipeline turns into the funnel metrics of `specs/15`. The line is
 * built field by field, so nothing else from the request can leak into it.
 */
@Injectable()
export class LoggingAnalyticsSink implements AnalyticsSink {
  private readonly logger = new Logger('analytics');

  async record(event: AnalyticsEvent): Promise<void> {
    this.logger.log(
      JSON.stringify({
        type: 'analytics',
        name: event.name,
        funnel: event.funnel,
        actorIdHash: event.actorIdHash,
        providerId: event.subject.providerId,
        serviceId: event.subject.serviceId,
        orderId: event.subject.orderId,
        conversationId: event.subject.conversationId,
        props: event.props,
        occurredAt: event.occurredAt.toISOString(),
      }),
    );
  }
}
