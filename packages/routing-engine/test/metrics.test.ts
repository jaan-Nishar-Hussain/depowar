import { describe, it, expect } from 'vitest';
import { createInMemoryRoutingMetrics, renderRoutingPrometheus } from '../src/metrics';
import { QuoteCache, swapCacheKey } from '../src/graph/cache';

describe('in-memory routing metrics', () => {
  it('counts considered, chosen, discarded, latency, and fallback events', () => {
    const metrics = createInMemoryRoutingMetrics();
    metrics.recordRouteConsidered('lifi');
    metrics.recordRouteConsidered('lifi');
    metrics.recordRouteConsidered('cctp');
    metrics.recordRouteChosen('lifi');
    metrics.recordRouteDiscarded('output below floor');
    metrics.recordQuoteLatency(42, 'ok');
    metrics.recordQuoteLatency(10, 'route_not_found');
    metrics.recordFallbackRequote(1, 'ok');

    const snapshot = metrics.snapshot();
    expect(snapshot.counters['routing_routes_considered_total{adapter="lifi"}']).toBe(2);
    expect(snapshot.counters['routing_routes_considered_total{adapter="cctp"}']).toBe(1);
    expect(snapshot.counters['routing_routes_chosen_total{adapter="lifi"}']).toBe(1);
    expect(snapshot.counters['routing_routes_discarded_total{reason="output below floor"}']).toBe(1);
    expect(snapshot.counters['routing_quotes_total{outcome="ok"}']).toBe(1);
    expect(snapshot.counters['routing_fallback_requotes_total{from_hop="1",outcome="ok"}']).toBe(1);
    expect(snapshot.quoteLatencyMsCount).toBe(2);
    expect(snapshot.quoteLatencyMsTotal).toBe(52);
  });

  it('renders Prometheus text format with HELP/TYPE headers', () => {
    const metrics = createInMemoryRoutingMetrics();
    metrics.recordRouteChosen('cctp-v2-1-8453');
    const text = renderRoutingPrometheus(metrics.snapshot());
    expect(text).toContain('# TYPE routing_routes_chosen_total counter');
    expect(text).toContain('routing_routes_chosen_total{adapter="cctp-v2-1-8453"} 1');
    expect(text).toContain('routing_quote_latency_ms_count 0');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('QuoteCache', () => {
  it('dedupes concurrent identical fetches', async () => {
    const cache = new QuoteCache();
    const key = swapCacheKey('a', 1, '0xa', '0xb', 10n);
    let calls = 0;
    const results = await Promise.all([
      cache.fetch(key, async () => { calls += 1; return 'first'; }),
      cache.fetch(key, async () => { calls += 1; return 'second'; }),
    ]);
    expect(calls).toBe(1);
    expect(results[0]).toBe('first');
    expect(results[1]).toBe('first');
  });
});
