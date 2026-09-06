import { Injectable } from '@nestjs/common';
import {
  createInMemoryRoutingMetrics,
  getSharedTelemetryStore,
  renderProviderTelemetryPrometheus,
  renderRoutingPrometheus,
  type RoutingMetricsSink,
  type RoutingMetricsSnapshot,
  type QuoteOutcome,
} from '@paymesh/routing-engine';
import { getRequestContext } from '../common/request-context';

function safe(value: string): string {
  return value.replace(/["\\]/g, '');
}

/**
 * Process-wide routing metrics sink (PRD §Monitoring & Observability). The
 * routing provider records candidate/latency telemetry into it; the metrics
 * controller exposes the snapshot in Prometheus text format.
 *
 * The sink handed to the engine additionally tags quote outcomes with the
 * authenticated tenant (`client_id` from the request context) so operators
 * can aggregate KPI failures per integrator — the same context the audit
 * service uses (PRD §Security). High-cardinality `request_id` stays in
 * structured logs rather than Prometheus labels.
 */
@Injectable()
export class RoutingMetricsService {
  private readonly sink = createInMemoryRoutingMetrics();
  private readonly requestCounters: Record<string, number> = {};
  private readonly httpCounters: Record<string, number> = {};

  /** Records one HTTP response for the API 5xx-rate alert. */
  recordHttpRequest(statusCode: number): void {
    const klass = `${Math.floor(statusCode / 100)}xx`;
    const key = `paymesh_api_http_requests_total{status_class="${klass}"}`;
    this.httpCounters[key] = (this.httpCounters[key] ?? 0) + 1;
  }

  get metrics(): RoutingMetricsSink {
    const base = this.sink;
    return {
      ...base,
      recordQuoteLatency: (durationMs: number, outcome: QuoteOutcome) => {
        base.recordQuoteLatency(durationMs, outcome);
        const clientId = getRequestContext()?.clientId ?? 'anonymous';
        const key = `routing_quote_requests_total{client_id="${safe(clientId)}",outcome="${outcome}"}`;
        this.requestCounters[key] = (this.requestCounters[key] ?? 0) + 1;
      },
    };
  }

  snapshot(): RoutingMetricsSnapshot {
    return this.sink.snapshot();
  }

  prometheus(): string {
    const counters = renderRoutingPrometheus(this.sink.snapshot());
    const telemetry = renderProviderTelemetryPrometheus(getSharedTelemetryStore().snapshot());
    const requestLines = [
      '# HELP routing_quote_requests_total Quote requests per tenant and outcome.',
      '# TYPE routing_quote_requests_total counter',
      ...Object.entries(this.requestCounters).map(([key, value]) => `${key} ${value}`),
    ].join('\n');
    const httpLines = [
      '# HELP paymesh_api_http_requests_total HTTP responses by status class.',
      '# TYPE paymesh_api_http_requests_total counter',
      ...Object.entries(this.httpCounters).map(([key, value]) => `${key} ${value}`),
    ].join('\n');
    return `${counters}${telemetry}${requestLines}\n${httpLines}\n`;
  }
}