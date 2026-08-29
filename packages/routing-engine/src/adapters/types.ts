import type { CandidateRoute, QuoteRequest, TransactionRequest } from '../types';

export interface SwapQuote {
  amountOut: bigint;
  fee: bigint;
  timeSeconds: number;
  reliability: number;
}

export interface BridgeQuote {
  amountOut: bigint;
  fee: bigint;
  timeSeconds: number;
  reliability: number;
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
}

export interface RouteProvider {
  readonly id: string;
  getCandidateRoutes(req: QuoteRequest): Promise<CandidateRoute[]>;
}