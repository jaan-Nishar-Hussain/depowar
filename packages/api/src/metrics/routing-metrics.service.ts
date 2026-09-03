import { Injectable } from '@nestjs/common';
import {
  createInMemoryRoutingMetrics,
  renderRoutingPrometheus,
  type RoutingMetricsSink,
  type RoutingMetricsSnapshot,
} from '@paymesh/routing-engine';

/**
 * Process-wide routing metrics sink (PRD §Monitoring & Observability). The
 * routing provider records candidate/latency telemetry into it; the metrics
 * controller exposes the snapshot in Prometheus text format.
 */
@Injectable()
export class RoutingMetricsService {
  private readonly sink = createInMemoryRoutingMetrics();

  get metrics(): RoutingMetricsSink {
    return this.sink;
  }

  snapshot(): RoutingMetricsSnapshot {
    return this.sink.snapshot();
  }

  prometheus(): string {
    return renderRoutingPrometheus(this.sink.snapshot());
  }
}