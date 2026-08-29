import type { Address, Hex } from 'viem';
import { DEFAULT_SLIPPAGE_BPS } from '@paymesh/config';

export type ChainId = number;

export type HopType = 'swap' | 'bridge' | 'transfer';

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
  adapterId: string;
  transactionRequest?: TransactionRequest;
  /** One signable transaction per hop, in route order. */
  hopTransactionRequests?: TransactionRequest[];
}

export interface Quote extends CandidateRoute {
  request: QuoteRequest;
  slippageBps: number;
}

export interface ScoreWeights {
  cost: number;
  time: number;
  slippage: number;
  reliability: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  cost: 0.4,
  time: 0.2,
  slippage: 0.2,
  reliability: 0.2,
};

export function effectiveSlippage(req: Pick<QuoteRequest, 'slippageBps'>): number {
  return req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
}