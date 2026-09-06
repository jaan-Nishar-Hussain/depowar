import { z } from 'zod';
import type { CandidateRoute, QuoteRequest, RouteHop, TransactionRequest } from '../../types';
import type { RouteProvider } from '../types';
import { executeRoute } from '../../execute';

export interface RouteApiAdapterOptions {
  baseUrl: string;
  id?: string;
  timeoutMs?: number;
}

interface ApiRoute {
  id?: string;
  outputAmount: string;
  fee?: string;
  timeSeconds?: number;
  reliability?: number;
  steps?: unknown[];
  transactionRequest?: TransactionRequest;
  hopTransactionRequests?: TransactionRequest[];
  liquidityScore?: number;
  priceImpactBps?: number;
  gasCost?: string;
  available?: boolean;
  riskScore?: number;
  metadata?: Record<string, string | number | boolean>;
}

interface ApiResponse {
  routes?: ApiRoute[];
  outputAmount?: string;
  fee?: string;
  timeSeconds?: number;
  reliability?: number;
  transactionRequest?: TransactionRequest;
  hopTransactionRequests?: TransactionRequest[];
}

/** BigInts arrive over JSON as decimal strings; normalize on parse. */
const bigintField = z.preprocess((value) => (typeof value === 'string' || typeof value === 'number' ? BigInt(value) : value), z.bigint());

const hopSchema = z.object({
  type: z.enum(['approval', 'swap', 'bridge', 'transfer']),
  chainId: z.number().int().optional(),
  fromChain: z.number().int().optional(),
  toChain: z.number().int().optional(),
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  amountIn: bigintField.optional(),
  amountOut: bigintField.optional(),
  protocol: z.string().optional(),
  actionFor: z.enum(['swap', 'bridge', 'transfer']).optional(),
});

/**
 * Validates provider-supplied hop steps against the engine's RouteHop shape
 * instead of trusting the raw JSON (PRD §Simulation & Validation: "do not
 * include unknown contracts"). Invalid steps are dropped; a route with no
 * remaining valid steps is discarded by the caller.
 */
function parseHopSteps(steps: unknown[] | undefined): RouteHop[] {
  if (!steps || steps.length === 0) return [];
  const hops: RouteHop[] = [];
  for (const step of steps) {
    const parsed = hopSchema.safeParse(step);
    if (parsed.success) hops.push(parsed.data as RouteHop);
  }
  return hops;
}

/**
 * Adapter for HTTP bridge/DEX aggregator APIs (LiFi/Socket-style). Returns
 * candidate routes parsed from the provider. In tests this is intercepted by
 * MSW so the routing engine never depends on live third-party liquidity.
 */
export function createRouteApiAdapter(options: RouteApiAdapterOptions): RouteProvider {
  const id = options.id ?? `http-${new URL(options.baseUrl).hostname}`;

  async function getCandidateRoutes(req: QuoteRequest): Promise<CandidateRoute[]> {
    const params = new URLSearchParams({
      fromChain: String(req.fromChain),
      toChain: String(req.toChain),
      fromToken: req.fromToken,
      toToken: req.toToken,
      fromAmount: req.fromAmount.toString(),
      ...(req.fromAddress ? { fromAddress: req.fromAddress } : {}),
      ...(req.toAddress ? { toAddress: req.toAddress } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    try {
      const res = await fetch(`${options.baseUrl}/quote?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Route provider ${id} returned ${res.status}`);
      }
      const body = (await res.json()) as ApiResponse;
      const raw: ApiRoute[] = body.routes ?? [{ outputAmount: body.outputAmount ?? '0' }];
      const routes: CandidateRoute[] = [];
      for (const [i, r] of raw.entries()) {
        const steps = parseHopSteps(r.steps);
        // Trust a provider's route only when its hops are either absent (a
        // plain legacy quote with an output amount) or fully validated. A
        // provider that returns malformed/untrusted hop steps is dropped.
        if (r.steps && r.steps.length > 0 && steps.length === 0) continue;
        routes.push({
          route: steps,
          estimatedOutput: BigInt(r.outputAmount),
          estimatedTimeSeconds: r.timeSeconds ?? 60,
          estimatedFee: r.fee ? BigInt(r.fee) : 0n,
          reliability: r.reliability ?? 0.9,
          liquidityScore: r.liquidityScore,
          priceImpactBps: r.priceImpactBps,
          gasCost: r.gasCost ? BigInt(r.gasCost) : undefined,
          available: r.available ?? true,
          riskScore: r.riskScore,
          providerMetadata: r.metadata,
          transactionRequest: r.transactionRequest,
          hopTransactionRequests: r.hopTransactionRequests,
          adapterId: r.id ?? `${id}-${i}`,
        });
      }
      return routes;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id,
    getCandidateRoutes,
    // Routes from this adapter carry hop transactions already; execution
    // delegates to the shared engine executor (PRD §Adapter Interfaces).
    executeRoute: (route, deps) => executeRoute(route, deps),
  };
}
