import { getQuote, type GetQuoteDeps } from './getQuote';
import { routeNotFound } from './errors';
import type { Quote, QuoteRequest } from './types';

/**
 * Fallback-route logic (PRD §11). Re-quotes a deposit excluding the adapters
 * that just failed so the worker can route around a broken bridge or DEX leg.
 * Throws ROUTE_NOT_FOUND when no adapter remains — the caller marks the
 * deposit FAILED.
 */
export async function getFallbackQuote(
  req: QuoteRequest,
  deps: GetQuoteDeps,
  excludeAdapterIds: string[],
): Promise<{ best: Quote; alternates: Quote[] }> {
  const swapAdapters = deps.swapAdapters.filter((a) => !excludeAdapterIds.includes(a.id));
  const bridgeAdapters = deps.bridgeAdapters.filter((a) => !excludeAdapterIds.includes(a.id));
  const routeProviders = (deps.routeProviders ?? []).filter(
    (a) => !excludeAdapterIds.includes(a.id),
  );

  const { best, alternates } = await getQuote(req, {
    swapAdapters,
    bridgeAdapters,
    routeProviders,
    telemetry: deps.telemetry,
    weights: deps.weights,
    metrics: deps.metrics,
    maxHops: deps.maxHops,
  });
  return { best, alternates };
}

export interface MidRouteFallbackInput {
  /**
   * State after the last confirmed hop: the token and chain the funds are
   * actually sitting on, and the amount that remains to route.
   */
  currentChain: number;
  currentToken: string;
  currentAmount: bigint;
  /** Number of hops already confirmed (for metrics and worker bookkeeping). */
  completedHops: number;
}

/**
 * Partial-route fallback (PRD §Execution & Fallback). When a mid-route hop
 * fails (e.g. the swap succeeded but the bridge broke), the remaining funds
 * sit in an intermediate state — re-quoting from the original input would
 * double-count. This re-quotes from the actual current state so the new route
 * starts exactly where execution stopped.
 */
export async function getFallbackQuoteFromHop(
  req: QuoteRequest,
  deps: GetQuoteDeps,
  excludeAdapterIds: string[],
  mid: MidRouteFallbackInput,
): Promise<{ best: Quote; alternates: Quote[] }> {
  const remaining: QuoteRequest = {
    ...req,
    fromChain: mid.currentChain,
    fromToken: mid.currentToken,
    fromAmount: mid.currentAmount,
    // Intermediate balances sit with the sender; the final delivery target
    // stays the recipient from the original request.
    toAddress: req.toAddress ?? req.fromAddress,
  };

  const swapAdapters = deps.swapAdapters.filter((a) => !excludeAdapterIds.includes(a.id));
  const bridgeAdapters = deps.bridgeAdapters.filter((a) => !excludeAdapterIds.includes(a.id));
  const routeProviders = (deps.routeProviders ?? []).filter(
    (a) => !excludeAdapterIds.includes(a.id),
  );

  if (bridgeAdapters.length === 0 && swapAdapters.length === 0 && (routeProviders ?? []).length === 0) {
    deps.metrics?.recordFallbackRequote(mid.completedHops, 'route_not_found');
    throw routeNotFound({ excluded: excludeAdapterIds, completedHops: mid.completedHops });
  }

  try {
    const { best, alternates } = await getQuote(remaining, {
      swapAdapters,
      bridgeAdapters,
      routeProviders,
      telemetry: deps.telemetry,
      weights: deps.weights,
      metrics: deps.metrics,
      maxHops: deps.maxHops,
    });
    deps.metrics?.recordFallbackRequote(mid.completedHops, 'ok');
    return { best, alternates };
  } catch (error) {
    if ((error as { code?: string }).code === 'ROUTE_NOT_FOUND') {
      deps.metrics?.recordFallbackRequote(mid.completedHops, 'route_not_found');
    }
    throw error;
  }
}
