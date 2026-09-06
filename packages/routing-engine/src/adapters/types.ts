import type { CandidateRoute, QuoteRequest, TransactionRequest } from '../types';
import type { ExecuteRouteDeps, ExecutionResult } from '../execute';

export interface SwapQuote {
  amountOut: bigint;
  fee: bigint;
  timeSeconds: number;
  reliability: number;
  liquidityScore?: number;
  priceImpactBps?: number;
  /** 0..1, higher is riskier (PRD §Scoring: risk dimension). */
  riskScore?: number;
  gasCost?: bigint;
  available?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface BridgeQuote {
  amountOut: bigint;
  fee: bigint;
  timeSeconds: number;
  reliability: number;
  liquidityScore?: number;
  priceImpactBps?: number;
  /** 0..1, higher is riskier (PRD §Scoring: risk dimension). */
  riskScore?: number;
  gasCost?: bigint;
  available?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface SwapAdapter {
  readonly id: string;
  readonly supportedChains: number[];
  quoteSwap(req: {
    chain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<SwapQuote>;
  buildSwapTransaction(req: QuoteRequest, quote: SwapQuote): Promise<TransactionRequest>;
  /** Optional ERC-20 approval transaction required before the swap. */
  buildApprovalTransaction?(req: QuoteRequest, amount: bigint): Promise<TransactionRequest>;
}

export interface BridgeAdapter {
  readonly id: string;
  readonly supportedFromChains: number[];
  readonly supportedToChains: number[];
  quoteBridge(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<BridgeQuote>;
  buildBridgeTransaction(req: QuoteRequest, quote: BridgeQuote): Promise<TransactionRequest>;
  /** Optional ERC-20 approval transaction required before the bridge deposit. */
  buildApprovalTransaction?(req: QuoteRequest, amount: bigint): Promise<TransactionRequest>;
  /**
   * Returns the source-chain representation of the asset that this bridge
   * can carry. This is useful when destination token addresses differ from
   * source token addresses (for example Circle USDC across CCTP domains).
   */
  sourceTokenFor?(req: { fromChain: number; toChain: number; tokenOut: string }): string;
  healthCheck?(): Promise<{ available: boolean; reliability?: number; reason?: string }>;
}

export interface RouteProvider {
  readonly id: string;
  getCandidateRoutes(req: QuoteRequest): Promise<CandidateRoute[]>;
  /**
   * Executes a route this provider produced (PRD §Adapter Interfaces).
   * Providers delegate to the shared engine executor, which signs and submits
   * the normalized hop transactions; the API/worker custody paths use the same
   * executor, so the seam exists literally without each provider re-implementing
   * broadcasting. Optional: a provider without executable hop transactions
   * (e.g. a pure quote source) can omit it and callers fall back to client-side
   * hop signing.
   */
  executeRoute?(route: CandidateRoute, deps: ExecuteRouteDeps): Promise<ExecutionResult>;
}

export interface ProviderTelemetry {
  reliability?: number;
  averageLatencyMs?: number;
  p95LatencyMs?: number;
  averageSlippageBps?: number;
  riskScore?: number;
}
