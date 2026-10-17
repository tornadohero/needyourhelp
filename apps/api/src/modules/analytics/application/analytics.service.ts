import { Inject, Injectable } from '@nestjs/common';

import { ANALYTICS_SINK } from '../domain/analytics-sink';
import type { AnalyticsSink } from '../domain/analytics-sink';
import type { AnalyticsEvent, TrackEventInput } from '../domain/analytics-event.model';
import { assertEventName, assertProps, funnelOf, hashActorId } from '../domain/analytics-policy';

/**
 * Analytics (`specs/15-analytics-spec.md`).
 *
 * The platform tracks what happened, never who a person is: the acting account
 * is hashed, the props are cleared of personal data — a child's identity most of
 * all — and the event is handed to a sink that never sees the request.
 *
 * An emitter that builds an illegal event fails loudly (it is a programming
 * error), but a sink that fails never fails the request: analytics is a side
 * effect, not a precondition (`specs/03` §Observability).
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink) {}

  /**
   * Emit a funnel event.
   *
   * Returns the event as it was sent, so a caller or a test can assert on it
   * without reaching into the sink.
   */
  async track(input: TrackEventInput): Promise<AnalyticsEvent | null> {
    const name = assertEventName(input.name);
    const props = assertProps(input.props);

    const event: AnalyticsEvent = {
      name,
      funnel: funnelOf(name),
      actorIdHash: hashActorId(input.actorUserId ?? null),
      subject: {
        providerId: input.providerId ?? null,
        serviceId: input.serviceId ?? null,
        orderId: input.orderId ?? null,
        conversationId: input.conversationId ?? null,
      },
      props,
      occurredAt: new Date(),
    };

    try {
      await this.sink.record(event);
    } catch {
      // A broken pipeline must never break a booking, a payment or a review.
      return null;
    }

    return event;
  }
}
