import type { CandidateRoute, QuoteRequest, TransactionRequest } from '../types';

export interface SwapQuote {
  amountOut: bigint;
  fee: bigint;
  timeSeconds: number;
  reliability: number;
  liquidityScore?: number;
  priceImpactBps?: number;
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
}

export interface ProviderTelemetry {
  reliability?: number;
  averageLatencyMs?: number;
  p95LatencyMs?: number;
  averageSlippageBps?: number;
  riskScore?: number;
}
