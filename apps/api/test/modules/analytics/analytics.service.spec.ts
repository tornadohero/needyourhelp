import { beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsService } from '../../../src/modules/analytics/application/analytics.service';
import type { AnalyticsEvent } from '../../../src/modules/analytics/domain/analytics-event.model';
import type { AnalyticsSink } from '../../../src/modules/analytics/domain/analytics-sink';

/** Records everything, and can be told to fail like a broken pipeline. */
class SpySink implements AnalyticsSink {
  readonly events: AnalyticsEvent[] = [];
  fail = false;

  async record(event: AnalyticsEvent): Promise<void> {
    if (this.fail) {
      throw new Error('pipeline down');
    }
    this.events.push(event);
  }
}

describe('AnalyticsService', () => {
  let sink: SpySink;
  let service: AnalyticsService;

  beforeEach(() => {
    sink = new SpySink();
    service = new AnalyticsService(sink);
  });

  it('sends an event with a hashed actor and the objects involved', async () => {
    const event = await service.track({
      name: 'order_created',
      actorUserId: 'user-1',
      providerId: 'provider-1',
      serviceId: 'service-1',
      orderId: 'order-1',
      props: { amount_minor: 20_000, has_child: true },
    });

    expect(event).toMatchObject({
      name: 'order_created',
      funnel: 'parent',
      subject: { providerId: 'provider-1', serviceId: 'service-1', orderId: 'order-1' },
      props: { amount_minor: 20_000, has_child: true },
    });
    // The raw account id never leaves the process.
    expect(event?.actorIdHash).not.toBe('user-1');
    expect(JSON.stringify(event)).not.toContain('user-1');
    expect(sink.events).toHaveLength(1);
  });

  it('refuses a child as a dimension, before anything is sent', async () => {
    await expect(
      service.track({ name: 'order_created', props: { child_id: 'child-1' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(sink.events).toHaveLength(0);
  });

  it('refuses an event the platform does not track', async () => {
    await expect(service.track({ name: 'page_viewed' as never })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(sink.events).toHaveLength(0);
  });

  it('never fails the request when the pipeline is down', async () => {
    sink.fail = true;

    // Analytics is a side effect: a booking still succeeds without it.
    await expect(service.track({ name: 'payment_succeeded' })).resolves.toBeNull();
  });
});
