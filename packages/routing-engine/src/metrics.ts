import type { ProviderTelemetry } from './adapters/types';

export type RouteOutcome = 'considered' | 'chosen' | 'discarded';
export type QuoteOutcome = 'ok' | 'route_not_found';

export interface RoutingMetricsSink {
  /** Called once per distinct adapter that contributed a candidate. */
  recordRouteConsidered(adapterId: string): void;
  /** Called for the adapter of the winning route. */
  recordRouteChosen(adapterId: string): void;
  /** Called when a candidate is discarded by validation. */
  recordRouteDiscarded(reason: string): void;
  /** Whole quote duration (graph fan-out + scoring). */
  recordQuoteLatency(durationMs: number, outcome: QuoteOutcome): void;
  /** Called when a fallback re-quote completes (mid-route or full). */
  recordFallbackRequote(fromHopIndex: number, outcome: QuoteOutcome): void;
}

export interface RoutingMetricsSnapshot {
  counters: Record<string, number>;
  quoteLatencyMsTotal: number;
  quoteLatencyMsCount: number;
  /** Cumulative counts per histogram bucket (PRD §Monitoring: p50/p95/p99). */
  quoteLatencyHistogram: Record<string, number>;
}

/** Histogram bucket ceilings in milliseconds (Prometheus `le` values). */
export const QUOTE_LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];

/**
 * Thread-safe (single-threaded Node) in-memory sink. The API exposes its
 * snapshot in Prometheus text format; tests assert on counters directly.
 */
export function createInMemoryRoutingMetrics(): RoutingMetricsSink & { snapshot(): RoutingMetricsSnapshot } {
  const counters: Record<string, number> = {};
  let latencyTotal = 0;
  let latencyCount = 0;
  const histogram: Record<string, number> = {};

  const bump = (key: string): void => {
    counters[key] = (counters[key] ?? 0) + 1;
  };

  return {
    recordRouteConsidered(adapterId) {
      bump(`routing_routes_considered_total{adapter="${safe(adapterId)}"}`);
    },
    recordRouteChosen(adapterId) {
      bump(`routing_routes_chosen_total{adapter="${safe(adapterId)}"}`);
    },
    recordRouteDiscarded(reason) {
      bump(`routing_routes_discarded_total{reason="${safe(reason)}"}`);
    },
    recordQuoteLatency(durationMs, outcome) {
      latencyTotal += durationMs;
      latencyCount += 1;
      bump(`routing_quotes_total{outcome="${outcome}"}`);
      for (const bucket of QUOTE_LATENCY_BUCKETS) {
        if (durationMs <= bucket) {
          const key = `routing_quote_latency_ms_bucket{le="${bucket}"}`;
          histogram[key] = (histogram[key] ?? 0) + 1;
        }
      }
      histogram['routing_quote_latency_ms_bucket{le="+Inf"}'] = (histogram['routing_quote_latency_ms_bucket{le="+Inf"}'] ?? 0) + 1;
    },
    recordFallbackRequote(fromHopIndex, outcome) {
      bump(`routing_fallback_requotes_total{from_hop="${fromHopIndex}",outcome="${outcome}"}`);
    },
    snapshot() {
      return {
        counters: { ...counters },
        quoteLatencyMsTotal: latencyTotal,
        quoteLatencyMsCount: latencyCount,
        quoteLatencyHistogram: { ...histogram },
      };
    },
  };
}

function safe(value: string): string {
  return value.replace(/["\\]/g, '');
}

/** Renders a snapshot as Prometheus text exposition format. */
export function renderRoutingPrometheus(snapshot: RoutingMetricsSnapshot): string {
  const lines: string[] = [];
  lines.push('# HELP routing_routes_considered_total Routes considered per adapter.');
  lines.push('# TYPE routing_routes_considered_total counter');
  lines.push('# HELP routing_routes_chosen_total Routes chosen per adapter.');
  lines.push('# TYPE routing_routes_chosen_total counter');
  lines.push('# HELP routing_routes_discarded_total Candidates discarded by validation.');
  lines.push('# TYPE routing_routes_discarded_total counter');
  lines.push('# HELP routing_quotes_total Quote requests by outcome.');
  lines.push('# TYPE routing_quotes_total counter');
  lines.push('# HELP routing_fallback_requotes_total Fallback requotes by start hop.');
  lines.push('# TYPE routing_fallback_requotes_total counter');
  for (const [key, value] of Object.entries(snapshot.counters)) {
    lines.push(`${key} ${value}`);
  }
  lines.push('# HELP routing_quote_latency_ms_sum Total quote latency.');
  lines.push('# TYPE routing_quote_latency_ms_sum counter');
  lines.push(`routing_quote_latency_ms_sum ${snapshot.quoteLatencyMsTotal}`);
  lines.push('# HELP routing_quote_latency_ms_count Quote attempts.');
  lines.push('# TYPE routing_quote_latency_ms_count counter');
  lines.push(`routing_quote_latency_ms_count ${snapshot.quoteLatencyMsCount}`);
  lines.push('# HELP routing_quote_latency_ms_bucket Quote latency histogram.');
  lines.push('# TYPE routing_quote_latency_ms_bucket histogram');
  for (const bucket of QUOTE_LATENCY_BUCKETS) {
    const count = snapshot.quoteLatencyHistogram[`routing_quote_latency_ms_bucket{le="${bucket}"}`] ?? 0;
    lines.push(`routing_quote_latency_ms_bucket{le="${bucket}"} ${count}`);
  }
  lines.push(`routing_quote_latency_ms_bucket{le="+Inf"} ${snapshot.quoteLatencyHistogram['routing_quote_latency_ms_bucket{le="+Inf"}'] ?? 0}`);
  lines.push(`routing_quote_latency_ms_bucket_sum ${snapshot.quoteLatencyMsTotal}`);
  lines.push(`routing_quote_latency_ms_bucket_count ${snapshot.quoteLatencyMsCount}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Renders the process-wide provider telemetry store (EWMA reliability,
 * average latency, average slippage) as Prometheus gauges. This is the
 * PRD's "aggregated KPIs" per provider: previously the EWMA was recorded for
 * scoring but never exported, so operators could not see provider health.
 */
export function renderProviderTelemetryPrometheus(telemetry: Record<string, ProviderTelemetry>): string {
  const entries = Object.entries(telemetry).filter(([, stats]) => Object.keys(stats).length > 0);
  if (entries.length === 0) return '';
  const lines: string[] = [
    '# HELP routing_provider_reliability EWMA reliability per provider (0..1).',
    '# TYPE routing_provider_reliability gauge',
    '# HELP routing_provider_latency_ms Average quote latency per provider (ms).',
    '# TYPE routing_provider_latency_ms gauge',
    '# HELP routing_provider_slippage_bps Average price impact per provider (bps).',
    '# TYPE routing_provider_slippage_bps gauge',
    '# HELP routing_provider_risk_score Risk score per provider (0..1, higher is riskier).',
    '# TYPE routing_provider_risk_score gauge',
  ];
  for (const [providerId, stats] of entries) {
    const label = `adapter="${safe(providerId)}"`;
    if (stats.reliability !== undefined) lines.push(`routing_provider_reliability{${label}} ${stats.reliability}`);
    if (stats.averageLatencyMs !== undefined) lines.push(`routing_provider_latency_ms{${label}} ${stats.averageLatencyMs}`);
    if (stats.averageSlippageBps !== undefined) lines.push(`routing_provider_slippage_bps{${label}} ${stats.averageSlippageBps}`);
    if (stats.riskScore !== undefined) lines.push(`routing_provider_risk_score{${label}} ${stats.riskScore}`);
  }
  return `${lines.join('\n')}\n`;
}
