import type { Address, Hex } from 'viem';
import { DEFAULT_SLIPPAGE_BPS } from '@paymesh/config';

export type ChainId = number;

export type HopType = 'approval' | 'swap' | 'bridge' | 'transfer';

export interface RouteHop {
  type: HopType;
  chainId?: ChainId;
  fromChain?: ChainId;
  toChain?: ChainId;
  fromToken?: string;
  toToken?: string;
  amountIn?: bigint;
  amountOut?: bigint;
  protocol?: string;
  /** For approval hops, identifies the action that consumes the allowance. */
  actionFor?: Exclude<HopType, 'approval'>;
}

export interface QuoteRequest {
  fromChain: ChainId;
  fromToken: string; // token address or 'native'
  fromAmount: bigint;
  toChain: ChainId;
  toToken: string; // token address or 'native'
  fromAddress?: Address;
  toAddress?: Address;
  slippageBps?: number;
}

/** viem-compatible transaction the sender signs (first hop of a route). */
export interface TransactionRequest {
  to: Address;
  data: Hex;
  value: bigint;
  chainId?: ChainId;
  from?: Address;
}

export interface CandidateRoute {
  route: RouteHop[];
  estimatedOutput: bigint;
  estimatedTimeSeconds: number;
  estimatedFee: bigint;
  reliability: number; // 0..1
  liquidityScore?: number; // 0..1
  priceImpactBps?: number;
  gasCost?: bigint;
  bridgeFee?: bigint;
  riskScore?: number; // 0..1, higher is riskier
  available?: boolean;
  providerMetadata?: Record<string, string | number | boolean>;
  adapterId: string;
  transactionRequest?: TransactionRequest;
  /** One signable transaction per hop, in route order. */
  hopTransactionRequests?: TransactionRequest[];
  /**
   * Weighted ranking penalty from `rankRoutes` (lower is better; 0 is the
   * best candidate in the set it was ranked against). Set by `rankRoutes`;
   * absent on candidates that were never scored (e.g. discarded pre-ranking).
   */
  score?: number;
}

export interface Quote extends CandidateRoute {
  request: QuoteRequest;
  slippageBps: number;
}

export interface ScoreWeights {
  output: number;
  cost: number;
  time: number;
  slippage: number;
  liquidity: number;
  reliability: number;
  risk: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  output: 0.4,
  cost: 0.1,
  time: 0.1,
  slippage: 0.1,
  liquidity: 0.1,
  reliability: 0.15,
  risk: 0.05,
};

export function effectiveSlippage(req: Pick<QuoteRequest, 'slippageBps'>): number {
  return req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
}
