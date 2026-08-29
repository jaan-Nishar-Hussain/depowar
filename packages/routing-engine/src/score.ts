import { DEFAULT_SCORE_WEIGHTS, type CandidateRoute, type QuoteRequest, type ScoreWeights } from './types';

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
  req: QuoteRequest,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): CandidateRoute[] {
  if (routes.length === 0) return [];

  const minCost = routes.reduce((m, r) => (r.estimatedFee < m ? r.estimatedFee : m), routes[0]!.estimatedFee);
  const minTime = routes.reduce((m, r) => (r.estimatedTimeSeconds < m ? r.estimatedTimeSeconds : m), routes[0]!.estimatedTimeSeconds);
  const maxReliability = routes.reduce((m, r) => (r.reliability > m ? r.reliability : m), 0);

  const scored: Scored[] = routes.map((route) => {
    const costScore = minCost > 0n ? Number(route.estimatedFee - minCost) / Math.max(1, Number(minCost)) : 0;
    const timeScore = minTime > 0 ? (route.estimatedTimeSeconds - minTime) / Math.max(1, minTime) : 0;
    const reliabilityScore = maxReliability > 0 ? 1 - route.reliability / maxReliability : 0;

    // Price impact as a proxy for slippage risk: how much output shrinks per
    // unit of input relative to a 1:1 transfer.
    const input = Number(req.fromAmount);
    const impact = input > 0 ? Math.max(0, 1 - Number(route.estimatedOutput) / input) : 0;
    const slippageScore = Math.min(1, impact);

    const score =
      weights.cost * costScore +
      weights.time * timeScore +
      weights.slippage * slippageScore +
      weights.reliability * reliabilityScore;

    return { route, score };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.route);
}