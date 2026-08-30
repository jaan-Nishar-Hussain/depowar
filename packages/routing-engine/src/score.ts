import { DEFAULT_SCORE_WEIGHTS, type CandidateRoute, type QuoteRequest, type ScoreWeights } from './types';
import type { ProviderTelemetry } from './adapters/types';

interface Scored {
  route: CandidateRoute;
  score: number;
}

/**
 * Ranks candidate routes lowest-score-first. Each metric is normalized against
 * the best value in the candidate set so weights are comparable regardless of
 * the absolute magnitudes involved.
 */
export function rankRoutes(
  routes: CandidateRoute[],
  _req: QuoteRequest,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
  telemetry: Record<string, ProviderTelemetry> = {},
): CandidateRoute[] {
  if (routes.length === 0) return [];

  const maxOutput = routes.reduce((m, r) => (r.estimatedOutput > m ? r.estimatedOutput : m), 0n);
  const totalCost = (route: CandidateRoute) => route.estimatedFee + (route.gasCost ?? 0n);
  const maxCost = routes.reduce((m, r) => {
    const cost = totalCost(r);
    return cost > m ? cost : m;
  }, 0n);
  const maxTime = routes.reduce((m, r) => Math.max(m, r.estimatedTimeSeconds), 0);

  const scored: Scored[] = routes.map((route) => {
    const stats = telemetry[route.adapterId];
    const outputScore = maxOutput > 0n ? 1 - bigintRatio(route.estimatedOutput, maxOutput) : 1;
    const costScore = maxCost > 0n ? bigintRatio(totalCost(route), maxCost) : 0;
    const timeScore = maxTime > 0 ? route.estimatedTimeSeconds / maxTime : 0;
    const reliability = stats?.reliability ?? route.reliability;
    const reliabilityScore = 1 - clamp(reliability);
    const liquidityScore = 1 - clamp(route.liquidityScore ?? 1);
    const slippageScore = Math.min(1, (route.priceImpactBps ?? 0) / 10_000);
    const riskScore = clamp(stats?.riskScore ?? route.riskScore ?? 0);

    const score =
      weights.output * outputScore +
      weights.cost * costScore +
      weights.time * timeScore +
      weights.slippage * slippageScore +
      weights.liquidity * liquidityScore +
      weights.reliability * reliabilityScore +
      weights.risk * riskScore;

    return { route, score };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.route);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bigintRatio(value: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  const scale = 1_000_000n;
  return Number((value * scale) / max) / Number(scale);
}
