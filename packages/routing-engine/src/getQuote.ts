import { encodeFunctionData, type Address } from 'viem';
import { readArtifact } from '@paymesh/contracts';
import { effectiveSlippage, type CandidateRoute, type Quote, type QuoteRequest, type RouteHop, type TransactionRequest } from './types';
import { rankRoutes } from './score';
import { routeNotFound } from './errors';
import type { BridgeAdapter, RouteProvider, SwapAdapter } from './adapters/types';

export interface GetQuoteDeps {
  swapAdapters: SwapAdapter[];
  bridgeAdapters: BridgeAdapter[];
  routeProviders?: RouteProvider[];
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
  const swapTx = await swap.buildSwapTransaction(req, swapQuote);
  const transferTx = buildTransferTransaction(req, swapQuote.amountOut);

  return {
    route: [
      {
        type: 'swap',
        chainId: req.fromChain,
        fromToken: req.fromToken,
        toToken: req.toToken,
        amountIn: req.fromAmount,
        amountOut: swapQuote.amountOut,
        protocol: swap.id,
      },
      {
        type: 'transfer',
        chainId: req.fromChain,
        fromToken: req.toToken,
        toToken: req.toToken,
        amountIn: swapQuote.amountOut,
        amountOut: swapQuote.amountOut,
        protocol: 'transfer',
      },
    ],
    estimatedOutput: swapQuote.amountOut,
    estimatedTimeSeconds: swapQuote.timeSeconds,
    estimatedFee: swapQuote.fee,
    reliability: swapQuote.reliability,
    adapterId: swap.id,
    transactionRequest: swapTx,
    hopTransactionRequests: [swapTx, transferTx],
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

  if (req.fromToken !== req.toToken && swapAdapter) {
    const swapQuote = await swapAdapter.quoteSwap({
      chain: req.fromChain,
      tokenIn: req.fromToken,
      tokenOut: req.toToken,
      amountIn: req.fromAmount,
    });
    hops.push({
      type: 'swap',
      chainId: req.fromChain,
      fromToken: req.fromToken,
      toToken: req.toToken,
      amountIn: req.fromAmount,
      amountOut: swapQuote.amountOut,
      protocol: swapAdapter.id,
    });
    txs.push(await swapAdapter.buildSwapTransaction(req, swapQuote));
    input = swapQuote.amountOut;
    time += swapQuote.timeSeconds;
    fee += swapQuote.fee;
    reliability *= swapQuote.reliability;
  }

  const bridgeQuote = await bridge.quoteBridge({
    fromChain: req.fromChain,
    toChain: req.toChain,
    tokenIn: req.toToken,
    tokenOut: req.toToken,
    amountIn: input,
  });
  hops.push({
    type: 'bridge',
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: req.toToken,
    toToken: req.toToken,
    amountIn: input,
    amountOut: bridgeQuote.amountOut,
    protocol: bridge.id,
  });
  // The bridge locks the post-swap token (the destination token) on the source
  // chain, so the signable tx is derived from a request whose fromToken is the
  // bridged asset at the post-swap amount.
  const bridgeRequest: QuoteRequest = { ...req, fromToken: req.toToken, fromAmount: input };
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
    const fromProvider = await provider.getCandidateRoutes(req);
    candidates.push(...fromProvider);
  }

  if (req.fromChain === req.toChain) {
    if (req.fromToken === req.toToken) {
      candidates.push(directCandidate(req));
    } else {
      for (const swap of deps.swapAdapters.filter((a) => a.supportedChains.includes(req.fromChain))) {
        candidates.push(await buildSameChainCandidate(req, swap));
      }
    }
  } else {
    for (const bridge of deps.bridgeAdapters.filter(
      (a) =>
        a.supportedFromChains.includes(req.fromChain) && a.supportedToChains.includes(req.toChain),
    )) {
      const swapAdapter = deps.swapAdapters.find((a) => a.supportedChains.includes(req.fromChain));
      // A cross-chain route needs a way to convert the source asset to the
      // bridge token on the source chain; without it the route is invalid.
      if (req.fromToken === req.toToken || swapAdapter) {
        candidates.push(await buildCrossChainCandidate(req, bridge, swapAdapter));
      }
    }
  }

  const ranked = rankRoutes(candidates, req);
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