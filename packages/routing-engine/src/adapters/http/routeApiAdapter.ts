import type { CandidateRoute, QuoteRequest } from '../../types';
import type { RouteProvider } from '../types';

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
}

interface ApiResponse {
  routes?: ApiRoute[];
  outputAmount?: string;
  fee?: string;
  timeSeconds?: number;
  reliability?: number;
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
      return raw.map((r, i) => ({
        route: (r.steps ?? []) as CandidateRoute['route'],
        estimatedOutput: BigInt(r.outputAmount),
        estimatedTimeSeconds: r.timeSeconds ?? 60,
        estimatedFee: r.fee ? BigInt(Math.round(Number(r.fee))) : 0n,
        reliability: r.reliability ?? 0.9,
        adapterId: r.id ?? `${id}-${i}`,
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  return { id, getCandidateRoutes };
}