import { encodeFunctionData, type Address } from 'viem';
import { readArtifact } from '@paymesh/contracts';
import { effectiveSlippage, type CandidateRoute, type Quote, type QuoteRequest, type RouteHop, type TransactionRequest } from './types';
import { rankRoutes } from './score';
import { routeNotFound } from './errors';
import type { BridgeAdapter, ProviderTelemetry, RouteProvider, SwapAdapter, SwapQuote } from './adapters/types';
import type { ScoreWeights } from './types';

export interface GetQuoteDeps {
  swapAdapters: SwapAdapter[];
  bridgeAdapters: BridgeAdapter[];
  routeProviders?: RouteProvider[];
  telemetry?: Record<string, ProviderTelemetry>;
  weights?: ScoreWeights;
}

const ERC20_ABI = readArtifact('MockERC20').abi;

/** Sends `amountOut` of the destination token to the recipient (terminal hop). */
function buildTransferTransaction(req: QuoteRequest, amountOut: bigint): TransactionRequest {
  if (!req.toAddress) {
    throw new Error('Transfer hop requires a destination address');
  }
  if (req.toToken === 'native') {
    return {
      to: req.toAddress as Address,
      data: '0x',
      value: amountOut,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }
  return {
    to: req.toToken as Address,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [req.toAddress as Address, amountOut],
    }),
    value: 0n,
    chainId: req.fromChain,
    from: req.fromAddress,
  };
}

function directCandidate(req: QuoteRequest): CandidateRoute {
  const transferTx = req.toAddress ? buildTransferTransaction(req, req.fromAmount) : undefined;
  return {
    route: req.toAddress
      ? [
          {
            type: 'transfer',
            chainId: req.fromChain,
            fromToken: req.fromToken,
            toToken: req.fromToken,
            amountIn: req.fromAmount,
            amountOut: req.fromAmount,
            protocol: 'direct',
          },
        ]
      : [],
    estimatedOutput: req.fromAmount,
    estimatedTimeSeconds: 0,
    estimatedFee: 0n,
    reliability: 1,
    liquidityScore: 1,
    priceImpactBps: 0,
    available: true,
    adapterId: 'direct',
    transactionRequest: transferTx,
    hopTransactionRequests: transferTx ? [transferTx] : [],
  };
}

async function buildSameChainCandidate(
  req: QuoteRequest,
  swap: SwapAdapter,
): Promise<CandidateRoute> {
  if (!req.toAddress) {
    throw new Error('Same-chain swap requires a destination address');
  }
  const swapQuote = await swap.quoteSwap({
    chain: req.fromChain,
    tokenIn: req.fromToken,
    tokenOut: req.toToken,
    amountIn: req.fromAmount,
  });
  const hops: RouteHop[] = [];
  const txs: TransactionRequest[] = [];
  if (req.fromToken !== 'native' && swap.buildApprovalTransaction) {
    hops.push({
      type: 'approval',
      chainId: req.fromChain,
      fromToken: req.fromToken,
      toToken: req.fromToken,
      amountIn: req.fromAmount,
      amountOut: req.fromAmount,
      protocol: swap.id,
      actionFor: 'swap',
    });
    txs.push(await swap.buildApprovalTransaction(req, req.fromAmount));
  }
  const swapTx = await swap.buildSwapTransaction(req, swapQuote);
  const transferTx = buildTransferTransaction(req, swapQuote.amountOut);
  hops.push({
    type: 'swap',
    chainId: req.fromChain,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.fromAmount,
    amountOut: swapQuote.amountOut,
    protocol: swap.id,
  });
  txs.push(swapTx);
  hops.push({
    type: 'transfer',
    chainId: req.fromChain,
    fromToken: req.toToken,
    toToken: req.toToken,
    amountIn: swapQuote.amountOut,
    amountOut: swapQuote.amountOut,
    protocol: 'transfer',
  });
  txs.push(transferTx);

  return {
    route: hops,
    estimatedOutput: swapQuote.amountOut,
    estimatedTimeSeconds: swapQuote.timeSeconds,
    estimatedFee: swapQuote.fee,
    reliability: swapQuote.reliability,
    liquidityScore: swapQuote.liquidityScore,
    priceImpactBps: swapQuote.priceImpactBps,
    gasCost: swapQuote.gasCost,
    available: swapQuote.available ?? swapQuote.amountOut > 0n,
    adapterId: swap.id,
    transactionRequest: txs[0] ?? swapTx,
    hopTransactionRequests: txs,
  };
}

async function buildCrossChainCandidate(
  req: QuoteRequest,
  bridge: BridgeAdapter,
  swapAdapter: SwapAdapter | undefined,
): Promise<CandidateRoute> {
  const hops: RouteHop[] = [];
  const txs: TransactionRequest[] = [];
  let input = req.fromAmount;
  let time = 0;
  let fee = 0n;
  let reliability = 1;
  let swapQuote: SwapQuote | undefined;
  const bridgeSourceToken = bridge.sourceTokenFor?.({
    fromChain: req.fromChain,
    toChain: req.toChain,
    tokenOut: req.toToken,
  }) ?? req.toToken;

  if (req.fromToken !== bridgeSourceToken && swapAdapter) {
    const swapRequest: QuoteRequest = { ...req, toChain: req.fromChain, toToken: bridgeSourceToken };
    if (req.fromToken !== 'native' && swapAdapter.buildApprovalTransaction) {
      hops.push({
        type: 'approval',
        chainId: req.fromChain,
        fromToken: req.fromToken,
        toToken: req.fromToken,
        amountIn: req.fromAmount,
        amountOut: req.fromAmount,
        protocol: swapAdapter.id,
        actionFor: 'swap',
      });
      txs.push(await swapAdapter.buildApprovalTransaction(req, req.fromAmount));
    }
    swapQuote = await swapAdapter.quoteSwap({
      chain: req.fromChain,
      tokenIn: req.fromToken,
      tokenOut: bridgeSourceToken,
      amountIn: req.fromAmount,
    });
    hops.push({
      type: 'swap',
      chainId: req.fromChain,
      fromToken: req.fromToken,
      toToken: bridgeSourceToken,
      amountIn: req.fromAmount,
      amountOut: swapQuote.amountOut,
      protocol: swapAdapter.id,
    });
    txs.push(await swapAdapter.buildSwapTransaction(swapRequest, swapQuote));
    input = swapQuote.amountOut;
    time += swapQuote.timeSeconds;
    fee += swapQuote.fee;
    reliability *= swapQuote.reliability;
  }

  const bridgeQuote = await bridge.quoteBridge({
    fromChain: req.fromChain,
    toChain: req.toChain,
    tokenIn: bridgeSourceToken,
    tokenOut: req.toToken,
    amountIn: input,
  });
  // The bridge locks the post-swap token (the destination token) on the source
  // chain, so the signable tx is derived from a request whose fromToken is the
  // bridged asset at the post-swap amount.
  const bridgeRequest: QuoteRequest = { ...req, fromToken: bridgeSourceToken, fromAmount: input };
  if (bridgeSourceToken !== 'native' && bridge.buildApprovalTransaction) {
    hops.push({
      type: 'approval',
      chainId: req.fromChain,
      fromToken: bridgeSourceToken,
      toToken: bridgeSourceToken,
      amountIn: input,
      amountOut: input,
      protocol: bridge.id,
      actionFor: 'bridge',
    });
    txs.push(await bridge.buildApprovalTransaction(bridgeRequest, input));
  }
  hops.push({
    type: 'bridge',
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: bridgeSourceToken,
    toToken: req.toToken,
    amountIn: input,
    amountOut: bridgeQuote.amountOut,
    protocol: bridge.id,
  });
  txs.push(await bridge.buildBridgeTransaction(bridgeRequest, bridgeQuote));
  time += bridgeQuote.timeSeconds;
  fee += bridgeQuote.fee;
  reliability *= bridgeQuote.reliability;

  return {
    route: hops,
    estimatedOutput: bridgeQuote.amountOut,
    estimatedTimeSeconds: time,
    estimatedFee: fee,
    reliability,
    liquidityScore: Math.min(swapQuote?.liquidityScore ?? 1, bridgeQuote.liquidityScore ?? 1),
    priceImpactBps: (swapQuote?.priceImpactBps ?? 0) + (bridgeQuote.priceImpactBps ?? 0),
    gasCost: (swapQuote?.gasCost ?? 0n) + (bridgeQuote.gasCost ?? 0n),
    bridgeFee: bridgeQuote.fee,
    available: (swapQuote?.available ?? swapQuote?.amountOut !== 0n) && (bridgeQuote.available ?? bridgeQuote.amountOut !== 0n),
    providerMetadata: bridgeQuote.metadata,
    adapterId: bridge.id,
    transactionRequest: txs[0],
    hopTransactionRequests: txs,
  };
}

/**
 * Core IP: given a deposit request, generate candidate routes across every
 * configured DEX/bridge/aggregator, score them, and return the best route plus
 * alternates. Each Quote carries one signable transaction per hop so a
 * non-custodial client can sign hop-by-hop; the worker drives confirmation and
 * settlement.
 */
export async function getQuote(
  req: QuoteRequest,
  deps: GetQuoteDeps,
): Promise<{ best: Quote; alternates: Quote[]; candidates: CandidateRoute[] }> {
  const slippage = effectiveSlippage(req);
  const candidates: CandidateRoute[] = [];

  for (const provider of deps.routeProviders ?? []) {
    try {
      const fromProvider = await provider.getCandidateRoutes(req);
      candidates.push(...fromProvider.filter((candidate) => candidate.available !== false));
    } catch {
      // One provider outage must not prevent other routes from being quoted.
    }
  }

  if (req.fromChain === req.toChain) {
    if (req.fromToken === req.toToken) {
      candidates.push(directCandidate(req));
    } else {
      for (const swap of deps.swapAdapters.filter((a) => a.supportedChains.includes(req.fromChain))) {
        try {
          const candidate = await buildSameChainCandidate(req, swap);
          if (candidate.available !== false) candidates.push(candidate);
        } catch {
          // Invalid/unavailable adapter is skipped.
        }
      }
    }
  } else {
    const bridges = deps.bridgeAdapters.filter(
      (a) => a.supportedFromChains.includes(req.fromChain) && a.supportedToChains.includes(req.toChain),
    );
    for (const bridge of bridges) {
      if (bridge.healthCheck) {
        try {
          const health = await bridge.healthCheck();
          if (!health.available) continue;
        } catch {
          continue;
        }
      }
      const swaps = deps.swapAdapters.filter((a) => a.supportedChains.includes(req.fromChain));
      // Evaluate every compatible swap × bridge combination. A bridge may
      // carry the source token directly, otherwise a swap is required.
      const bridgeSourceToken = bridge.sourceTokenFor?.({
        fromChain: req.fromChain,
        toChain: req.toChain,
        tokenOut: req.toToken,
      }) ?? req.toToken;
      const compatibleSwaps = req.fromToken === bridgeSourceToken ? [undefined] : swaps;
      for (const swapAdapter of compatibleSwaps) {
        try {
          const candidate = await buildCrossChainCandidate(req, bridge, swapAdapter);
          if (candidate.available !== false) candidates.push(candidate);
        } catch {
          // Continue evaluating other providers.
        }
      }
    }
  }

  const ranked = rankRoutes(candidates, req, deps.weights, deps.telemetry);
  const bestRoute = ranked[0];
  if (!bestRoute) {
    throw routeNotFound({ request: req });
  }

  const toQuote = (route: CandidateRoute): Quote => ({
    ...route,
    request: req,
    slippageBps: slippage,
  });

  return {
    best: toQuote(bestRoute),
    alternates: ranked.slice(1).map(toQuote),
    candidates: ranked,
  };
}
