import { Module } from '@nestjs/common';

import { AnalyticsService } from './application/analytics.service';
import { ANALYTICS_SINK } from './domain/analytics-sink';
import { LoggingAnalyticsSink } from './infrastructure/logging-analytics-sink';

/**
 * Analytics context (`specs/03-architecture-spec.md` §Backend modules:
 * analytics; `specs/15-analytics-spec.md`).
 *
 * It depends on nothing else: every other context emits into it, and it writes
 * nowhere but the log. Swapping the sink for a warehouse client touches this
 * module only.
 */
@Module({
  providers: [AnalyticsService, { provide: ANALYTICS_SINK, useClass: LoggingAnalyticsSink }],
  exports: [AnalyticsService, ANALYTICS_SINK],
})
export class AnalyticsModule {}
