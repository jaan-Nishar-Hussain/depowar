import type { BridgeQuote, BridgeAdapter, SwapAdapter, SwapQuote } from '../adapters/types';
import type { GetQuoteDeps } from '../getQuote';
import { effectiveSlippage, type CandidateRoute, type QuoteRequest, type RouteHop, type TransactionRequest } from '../types';
import { emptyAccumulator, mergeQuoteTotals, nodeKey, sameToken, type ComposedLeg, type ComposeAccumulator, type ComposeState } from './types';
import { bridgeCacheKey, QuoteCache, swapCacheKey } from './cache';
import { buildTransferTransaction } from './hops';

export interface SearchOptions {
  /** Maximum adapter legs (excluding approvals) in a composed route. */
  maxHops?: number;
  /** Cap on composed candidates returned (bounded fan-out). */
  maxPaths?: number;
  /**
   * Additional tokens the explorer may target with same-chain swaps on a
   * chain (beyond the destination token and bridge-carried tokens).
   */
  candidateTokens?: (chainId: number) => string[];
}

/**
 * Route-graph explorer (PRD §Route Graph). Nodes are (chain, token) pairs;
 * adapters provide edges lazily. The explorer composes multi-leg routes
 * (swap → swap → bridge) that the direct swap×bridge enumeration in
 * `getQuote` cannot reach, then returns them in the standard CandidateRoute
 * shape so ranking, quoting, and execution need no changes.
 *
 * Invariants:
 * - every hop has exactly one index-aligned executable transaction;
 * - intermediate legs deliver funds back to the sender (all swap adapters
 *   transfer output to `fromAddress`), bridge legs deliver to the recipient;
 * - exploration is depth-bounded and quote-memoized, so fan-out stays small.
 */
export async function searchComposedRoutes(
  req: QuoteRequest,
  deps: GetQuoteDeps,
  options: SearchOptions = {},
): Promise<CandidateRoute[]> {
  const maxHops = options.maxHops ?? 3;
  const maxPaths = options.maxPaths ?? 8;
  const cache = new QuoteCache();
  const targetKey = nodeKey(req.toChain, req.toToken);
  const sourceKey = nodeKey(req.fromChain, req.fromToken);
  const slippage = effectiveSlippage(req);

  const bridgesOn = (chainId: number): BridgeAdapter[] =>
    deps.bridgeAdapters.filter((b) => b.supportedFromChains.includes(chainId) && b.supportedToChains.includes(req.toChain));

  const swapsOn = (chainId: number): SwapAdapter[] =>
    deps.swapAdapters.filter((a) => a.supportedChains.includes(chainId));

  /** Tokens a bridge departing `chainId` can carry (its source-side asset). */
  function bridgeCarriedTokens(chainId: number): string[] {
    const tokens = new Set<string>();
    for (const bridge of bridgesOn(chainId)) {
      const source = bridge.sourceTokenFor?.({ fromChain: chainId, toChain: req.toChain, tokenOut: req.toToken });
      if (source) tokens.add(source);
    }
    return [...tokens];
  }

  function nextTokensOn(chainId: number): string[] {
    const tokens = new Set<string>();
    if (chainId === req.toChain) tokens.add(req.toToken);
    for (const token of bridgeCarriedTokens(chainId)) tokens.add(token);
    for (const token of options.candidateTokens?.(chainId) ?? []) tokens.add(token);
    return [...tokens];
  }

  function isUsable(quote: { amountOut: bigint; available?: boolean }): boolean {
    if (quote.available === false) return false;
    return quote.amountOut > 0n;
  }

  async function quoteSwapOn(
    swap: SwapAdapter,
    state: ComposeState,
    tokenOut: string,
  ): Promise<SwapQuote | null> {
    const key = swapCacheKey(swap.id, state.chainId, state.token, tokenOut, state.amount);
    const quote = await cache.fetch(key, async (): Promise<SwapQuote | null> => {
      try {
        return await swap.quoteSwap({ chain: state.chainId, tokenIn: state.token, tokenOut, amountIn: state.amount });
      } catch {
        return null;
      }
    });
    return quote && isUsable(quote) ? quote : null;
  }

  async function quoteBridgeOn(
    bridge: BridgeAdapter,
    state: ComposeState,
    tokenIn: string,
  ): Promise<BridgeQuote | null> {
    const key = bridgeCacheKey(bridge.id, state.chainId, req.toChain, tokenIn, req.toToken, state.amount);
    const quote = await cache.fetch(key, async (): Promise<BridgeQuote | null> => {
      if (bridge.healthCheck) {
        try {
          const health = await bridge.healthCheck();
          if (!health.available) return null;
        } catch {
          return null;
        }
      }
      try {
        return await bridge.quoteBridge({
          fromChain: state.chainId,
          toChain: req.toChain,
          tokenIn,
          tokenOut: req.toToken,
          amountIn: state.amount,
        });
      } catch {
        return null;
      }
    });
    return quote && isUsable(quote) ? quote : null;
  }
/** Synthetic per-leg request. Swap adapters send output to the sender. */
  function swapRequestFor(state: ComposeState, tokenOut: string): QuoteRequest {
    return {
      fromChain: state.chainId,
      fromToken: state.token,
      fromAmount: state.amount,
      toChain: state.chainId,
      toToken: tokenOut,
      fromAddress: req.fromAddress,
      toAddress: req.fromAddress,
      slippageBps: req.slippageBps,
    };
  }

  /** Synthetic per-leg request for a bridge delivering to the recipient. */
  function bridgeRequestFor(state: ComposeState): QuoteRequest {
    return {
      fromChain: state.chainId,
      fromToken: state.token,
      fromAmount: state.amount,
      toChain: req.toChain,
      toToken: req.toToken,
      fromAddress: req.fromAddress,
      toAddress: req.toAddress,
      slippageBps: req.slippageBps,
    };
  }

  interface LegTransactions {
    approval?: TransactionRequest;
    tx: TransactionRequest;
  }
function composeSwapLeg(
  swap: SwapAdapter,
  state: ComposeState,
  tokenOut: string,
  quote: SwapQuote,
  legTxs: LegTransactions,
): ComposedLeg[] {
  const legs: ComposedLeg[] = [];
  if (legTxs.approval) {
    legs.push({
      hop: {
        type: 'approval', chainId: state.chainId,
        fromToken: state.token, toToken: state.token,
        amountIn: state.amount, amountOut: state.amount,
        protocol: swap.id, actionFor: 'swap',
      },
      tx: legTxs.approval,
    });
  }
  legs.push({
    hop: {
      type: 'swap', chainId: state.chainId,
      fromToken: state.token, toToken: tokenOut,
      amountIn: state.amount, amountOut: quote.amountOut,
      protocol: swap.id,
    },
    tx: legTxs.tx,
  });
  return legs;
}

function composeBridgeLeg(
  bridge: BridgeAdapter,
  state: ComposeState,
  quote: BridgeQuote,
  legTxs: LegTransactions,
): ComposedLeg[] {
  const legs: ComposedLeg[] = [];
  if (legTxs.approval) {
    legs.push({
      hop: {
        type: 'approval', chainId: state.chainId,
        fromToken: state.token, toToken: state.token,
        amountIn: state.amount, amountOut: state.amount,
        protocol: bridge.id, actionFor: 'bridge',
      },
      tx: legTxs.approval,
    });
  }
  legs.push({
    hop: {
      type: 'bridge', chainId: state.chainId,
      fromChain: state.chainId, toChain: req.toChain,
      fromToken: state.token, toToken: req.toToken,
      amountIn: state.amount, amountOut: quote.amountOut,
      protocol: bridge.id,
    },
    tx: legTxs.tx,
  });
  return legs;
}

async function swapLegTransactions(
  swap: SwapAdapter,
  state: ComposeState,
  tokenOut: string,
  quote: SwapQuote,
): Promise<LegTransactions | null> {
  const sreq = swapRequestFor(state, tokenOut);
  try {
    if (state.token !== 'native' && swap.buildApprovalTransaction) {
      const approval = await swap.buildApprovalTransaction(sreq, state.amount);
      return { approval, tx: await swap.buildSwapTransaction(sreq, quote) };
    }
    return { tx: await swap.buildSwapTransaction(sreq, quote) };
  } catch {
    return null;
  }
}

async function bridgeLegTransactions(
  bridge: BridgeAdapter,
  state: ComposeState,
  quote: BridgeQuote,
): Promise<LegTransactions | null> {
  const breq = bridgeRequestFor(state);
  try {
    if (state.token !== 'native' && bridge.buildApprovalTransaction) {
      const approval = await bridge.buildApprovalTransaction(breq, state.amount);
      return { approval, tx: await bridge.buildBridgeTransaction(breq, quote) };
    }
    return { tx: await bridge.buildBridgeTransaction(breq, quote) };
  } catch {
    return null;
  }
}
/**
 * Terminal leg: the sender transfers the settled token balance to the
 * recipient. Only valid on the source chain — a bridge landing on the
 * destination chain already delivers to `req.toAddress` directly.
 */
function composeTerminalTransfer(state: ComposeState): ComposedLeg | null {
  const tx = buildTransferTransaction(
    { ...req, fromChain: state.chainId, toToken: state.token },
    state.amount,
  );
  if (!tx) return null;
  return {
    hop: {
      type: 'transfer', chainId: state.chainId,
      fromToken: state.token, toToken: state.token,
      amountIn: state.amount, amountOut: state.amount,
      protocol: 'direct',
    },
    tx,
  };
}

interface ComposedPath {
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
}

function finishPath(legs: ComposedLeg[], acc: ComposeAccumulator, adapterIds: string[]): ComposedPath {
  return {
    legs,
    hops: legs.map((leg) => leg.hop),
    transactions: legs.map((leg) => leg.tx),
    amountOut: acc.amountOut,
    fee: acc.fee,
    gasCost: acc.gasCost,
    timeSeconds: acc.timeSeconds,
    reliability: acc.reliability,
    priceImpactBps: acc.priceImpactBps,
    liquidityScore: acc.liquidityScore,
    adapterIds,
  };
}

async function expand(
  state: ComposeState,
  depth: number,
  legs: ComposedLeg[],
  acc: ComposeAccumulator,
  adapterIds: string[],
  out: ComposedPath[],
): Promise<void> {
  if (out.length >= maxPaths) return;

  const stateKey = nodeKey(state.chainId, state.token);

  if (stateKey === targetKey) {
    // A bridge leg delivers straight to the recipient on the destination
    // chain, so a path ending on such a leg is complete. If the destination
    // token balance is still held by the sender on the source chain, one
    // final signable transfer hop completes the route.
    const lastLeg = legs[legs.length - 1];
    if (lastLeg?.hop.type === 'bridge' || lastLeg?.hop.type === 'transfer') {
      out.push(finishPath(legs, acc, adapterIds));
      return;
    }
    if (state.chainId === req.fromChain) {
      const terminal = composeTerminalTransfer(state);
      if (terminal) out.push(finishPath([...legs, terminal], { ...acc }, adapterIds));
    }
    return;
  }
  if (depth >= maxHops) return;

  // Same-chain swap edges toward useful tokens (the destination token on the
  // destination chain is unreachable for swaps; here it means same-chain
  // deposits). This composes token → USDC → bridge paths.
  const swapTargets = nextTokensOn(state.chainId).filter((token) => !sameToken(token, state.token));
  for (const tokenOut of swapTargets) {
    for (const swap of swapsOn(state.chainId)) {
      if (out.length >= maxPaths) return;
      const quote = await quoteSwapOn(swap, state, tokenOut);
      if (!quote) continue;
      const txs = await swapLegTransactions(swap, state, tokenOut, quote);
      if (!txs) continue;
      const nextLegs = composeSwapLeg(swap, state, tokenOut, quote, txs);
      await expand(
        { chainId: state.chainId, token: tokenOut, amount: quote.amountOut },
        depth + 1,
        [...legs, ...nextLegs],
        mergeQuoteTotals(acc, quote),
        [...adapterIds, swap.id],
        out,
      );
    }
  }

  // Bridge edges. A bridge without sourceTokenFor carries the same asset
  // across chains (legacy semantics: only the destination token itself), so a
  // pass-through leg is only valid from the destination token. Mapped-asset
  // bridges (e.g. CCTP carries Circle USDC only) are reached through the swap
  // edges above and taken here when the current token matches the mapped asset.
  if (state.chainId !== req.toChain) {
    for (const bridge of bridgesOn(state.chainId)) {
      if (out.length >= maxPaths) return;
      const mapped = bridge.sourceTokenFor?.({ fromChain: state.chainId, toChain: req.toChain, tokenOut: req.toToken });
      const acceptable = mapped
        ? sameToken(mapped, state.token)
        : sameToken(state.token, req.toToken);
      if (!acceptable) continue;
      const quote = await quoteBridgeOn(bridge, state, state.token);
      if (!quote) continue;
      const txs = await bridgeLegTransactions(bridge, state, quote);
      if (!txs) continue;
      const nextLegs = composeBridgeLeg(bridge, state, quote, txs);
      await expand(
        { chainId: req.toChain, token: req.toToken, amount: quote.amountOut },
        depth + 1,
        [...legs, ...nextLegs],
        mergeQuoteTotals(acc, quote),
        [...adapterIds, bridge.id],
        out,
      );
    }
  }
}

  const out: ComposedPath[] = [];
  const initialState: ComposeState = { chainId: req.fromChain, token: req.fromToken, amount: req.fromAmount };
  if (sourceKey !== targetKey) {
    await expand(initialState, 0, [], emptyAccumulator(), [], out);
  }

  return out.map((path) => ({
    route: path.hops,
    estimatedOutput: path.amountOut,
    estimatedTimeSeconds: path.timeSeconds,
    estimatedFee: path.fee,
    reliability: path.reliability,
    liquidityScore: path.liquidityScore,
    priceImpactBps: path.priceImpactBps,
    gasCost: path.gasCost,
    available: true,
    providerMetadata: {
      composed: true,
      legs: path.legs.length,
      adapters: path.adapterIds.join('+'),
      slippageBps: slippage,
    },
    adapterId: `graph:${path.adapterIds.join('+')}`,
    transactionRequest: path.transactions[0],
    hopTransactionRequests: path.transactions,
  }));
}
