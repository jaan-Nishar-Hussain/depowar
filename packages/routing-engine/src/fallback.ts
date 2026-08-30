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

  if (bridgeAdapters.length === 0 && swapAdapters.length === 0 && routeProviders.length === 0) {
    throw routeNotFound({ excluded: excludeAdapterIds });
  }

  const { best, alternates } = await getQuote(req, {
    swapAdapters,
    bridgeAdapters,
    routeProviders,
    telemetry: deps.telemetry,
    weights: deps.weights,
  });
  return { best, alternates };
}
