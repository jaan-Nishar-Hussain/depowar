import type { BridgeAdapter, SwapAdapter } from '../adapters/types';
import type { RouteHop, TransactionRequest } from '../types';

/** Node identity in the route graph: a token on a chain. */
export type NodeKey = string;

/**
 * Builds the canonical node key for a (chain, token) pair. Token addresses are
 * lower-cased so comparisons are case-insensitive; `native` is its own token.
 */
export function nodeKey(chainId: number, token: string): NodeKey {
  return `${chainId}:${token === 'native' ? 'native' : token.toLowerCase()}`;
}

export function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === b) return true;
  if (a === 'native' || b === 'native') return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * An edge in the route graph. Edges are produced lazily by adapters: a swap
 * adapter provides edges between tokens on one chain, a bridge adapter
 * provides edges between the same (or mapped) token across chains.
 */
export interface GraphEdge {
  adapterId: string;
  kind: 'swap' | 'bridge';
  from: NodeKey;
  to: NodeKey;
  swap?: SwapAdapter;
  bridge?: BridgeAdapter;
  chainId?: number;
  fromChain?: number;
  toChain?: number;
}

/** Current position while composing a route: token balance the sender holds. */
export interface ComposeState {
  chainId: number;
  token: string;
  amount: bigint;
}

/** One composed leg: a route hop plus its executable transaction. */
export interface ComposedLeg {
  hop: RouteHop;
  tx: TransactionRequest;
}

/**
 * A fully composed path through the graph. `hops` and `transactions` are
 * index-aligned — the API and worker rely on that invariant.
 */
export interface ComposedPath {
  legs: ComposedLeg[];
  hops: RouteHop[];
  transactions: TransactionRequest[];
  amountOut: bigint;
  fee: bigint;
  gasCost: bigint;
  timeSeconds: number;
  reliability: number;
  priceImpactBps: number;
  liquidityScore: number;
  adapterIds: string[];
  metadata: Record<string, string | number | boolean>;
}

/** Aggregate totals while composing. */
export interface ComposeAccumulator {
  amountOut: bigint;
  fee: bigint;
  gasCost: bigint;
  timeSeconds: number;
  reliability: number;
  priceImpactBps: number;
  liquidityScore: number;
}

export function emptyAccumulator(): ComposeAccumulator {
  return {
    amountOut: 0n,
    fee: 0n,
    gasCost: 0n,
    timeSeconds: 0,
    reliability: 1,
    priceImpactBps: 0,
    liquidityScore: 1,
  };
}

export function mergeQuoteTotals(
  acc: ComposeAccumulator,
  quote: { amountOut: bigint; fee: bigint; timeSeconds: number; reliability: number; liquidityScore?: number; priceImpactBps?: number; gasCost?: bigint },
): ComposeAccumulator {
  return {
    amountOut: quote.amountOut,
    fee: acc.fee + quote.fee,
    gasCost: acc.gasCost + (quote.gasCost ?? 0n),
    timeSeconds: acc.timeSeconds + quote.timeSeconds,
    reliability: Math.min(acc.reliability, quote.reliability),
    priceImpactBps: acc.priceImpactBps + (quote.priceImpactBps ?? 0),
    liquidityScore: Math.min(acc.liquidityScore, quote.liquidityScore ?? 1),
  };
}
