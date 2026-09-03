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
}

/**
 * Thread-safe (single-threaded Node) in-memory sink. The API exposes its
 * snapshot in Prometheus text format; tests assert on counters directly.
 */
export function createInMemoryRoutingMetrics(): RoutingMetricsSink & { snapshot(): RoutingMetricsSnapshot } {
  const counters: Record<string, number> = {};
  let latencyTotal = 0;
  let latencyCount = 0;

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
    },
    recordFallbackRequote(fromHopIndex, outcome) {
      bump(`routing_fallback_requotes_total{from_hop="${fromHopIndex}",outcome="${outcome}"}`);
    },
    snapshot() {
      return { counters: { ...counters }, quoteLatencyMsTotal: latencyTotal, quoteLatencyMsCount: latencyCount };
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
  return `${lines.join('\n')}\n`;
}
