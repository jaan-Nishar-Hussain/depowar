import { Job } from 'bullmq';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { cctpDomain, cctpTokenMessenger, getChain, getToken, mainnetUniswap, MIN_CONFIRMATIONS, QUOTE_TTL_SECONDS } from '@paymesh/config';
import { generateId } from '@paymesh/db';
import {
  getFallbackQuote,
  getFallbackQuoteFromHop,
  createDefaultAdapters,
  createRouteApiAdapter,
  createLifiRouteProvider,
  type QuoteRequest,
} from '@paymesh/routing-engine';
import { WorkerContext, emitEvent, enqueueFallback, enqueueSettlement } from './context';
import { viemChain } from './viem';
import { stringifyBigInts } from './json';
import type { RouteHopLike } from './types';

interface MonitorJobData {
  transactionId: string;
}

/**
 * Watches a submitted hop. On confirm, advances the deposit (either to the
 * next signable hop or to settlement). On revert/timeout, triggers the
 * fallback-route job so the deposit can route around the failure.
 */
export async function processTxMonitor(job: Job<MonitorJobData>, ctx: WorkerContext): Promise<void> {
  const { transactionId } = job.data;

  const transaction = await ctx.prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { quote: { include: { depositIntent: true } } },
  });
  if (!transaction) return;

  if (!['SUBMITTED', 'TIMEOUT', 'SETTLEMENT_PENDING'].includes(transaction.status) || !transaction.txHash) {
    // Not yet submitted — nothing to monitor yet.
    return;
  }

  const chainInfo = getChain(transaction.chainId);
  const client = createPublicClient({
    chain: viemChain(transaction.chainId),
    transport: http(chainInfo.rpcUrl),
  });

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: transaction.txHash as Hex,
      confirmations: MIN_CONFIRMATIONS,
      timeout: ctx.env.TX_MONITOR_TIMEOUT_MS,
    });
  } catch {
    await ctx.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'TIMEOUT', errorCode: 'TX_TIMEOUT' },
    });
    // A timeout does not prove that the transaction was dropped. Retrying the
    // monitor is safe; routing the same funds again before the original tx is
    // known to be failed is not. Once BullMQ's monitor retries are exhausted,
    // route around the stuck hop via the fallback queue (PRD §Fallback).
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      await triggerFallback(ctx, transaction.quote, transaction.hopIndex);
      return;
    }
    throw new Error(`Transaction ${transaction.txHash} is still pending`);
  }

  if (receipt.status === 'reverted') {
    await ctx.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'FAILED', errorCode: 'TX_REVERTED' },
    });
    await triggerFallback(ctx, transaction.quote, transaction.hopIndex);
    return;
  }

  const route = (transaction.quote.routePath as unknown as RouteHopLike[]) ?? [];
  const hop = route[transaction.hopIndex];
  const nextHopIndex = transaction.hopIndex + 1;
  const terminalSettlement = nextHopIndex >= route.length && (hop?.type === 'bridge' || hop?.type === 'transfer');
  await ctx.prisma.transaction.update({
    where: { id: transaction.id },
    data: { status: terminalSettlement ? 'SETTLEMENT_PENDING' : 'CONFIRMED', confirmedAt: terminalSettlement ? undefined : new Date() },
  });
  await emitEvent(ctx, {
    clientId: transaction.quote.depositIntent.clientId,
    type: 'tx.confirmed',
    payload: {
      depositId: transaction.depositIntentId,
      quoteId: transaction.quoteId,
      hopIndex: transaction.hopIndex,
      txHash: transaction.txHash,
    },
    depositIntentId: transaction.depositIntentId,
  });

  if (nextHopIndex < route.length) {
    // More sender-signed hops remain: back to AWAITING_SIGNATURE.
    await ctx.prisma.depositIntent.update({
      where: { id: transaction.depositIntentId },
      data: { status: 'AWAITING_SIGNATURE' },
    });
    await emitEvent(ctx, {
      clientId: transaction.quote.depositIntent.clientId,
      type: 'quote.ready',
      payload: {
        depositId: transaction.depositIntentId,
        quoteId: transaction.quoteId,
        hopIndex: nextHopIndex,
      },
      depositIntentId: transaction.depositIntentId,
    });
    return;
  }

  // Terminal hop: hand off to the dedicated settlement queue so a long CCTP
  // attestation wait does not block the single-concurrency tx-monitor.
  if (hop?.type === 'bridge' || hop?.type === 'transfer') {
    await enqueueSettlement(ctx, transaction.id);
  }
}

/**
 * Number of chained fallback re-quotes already performed for this deposit,
 * derived from the `fallbackFromQuoteId` chain (PRD §Fallback Safety: no
 * infinite loops). The original quote has depth 0; each re-quote adds one.
 */
async function getFallbackDepth(ctx: WorkerContext, quoteId: string): Promise<number> {
  let depth = 0;
  let current = quoteId;
  while (current) {
    const row = await ctx.prisma.quote.findUnique({
      where: { id: current },
      select: { fallbackFromQuoteId: true },
    }) as { fallbackFromQuoteId: string | null } | null;
    if (!row?.fallbackFromQuoteId) break;
    depth += 1;
    current = row.fallbackFromQuoteId;
  }
  return depth;
}

async function triggerFallback(
  ctx: WorkerContext,
  quote: { id: string; depositIntentId: string; providerId?: string | null; fromChainId: number; fromToken: string; fromAmount: unknown; routePath: unknown },
  failedHopIndex: number,
): Promise<void> {
  const route = (quote.routePath as unknown as RouteHopLike[]) ?? [];
  // Prefer the failing hop's adapter; fall back to the quote's recorded
  // provider so an unknown hop never causes a re-quote that re-selects the
  // exact route that just failed.
  const failedAdapterId = route[failedHopIndex]?.protocol ?? quote.providerId ?? null;

  const depth = await getFallbackDepth(ctx, quote.id);
  if (depth >= ctx.env.FALLBACK_MAX_DEPTH) {
    await failDeposit(ctx, quote.depositIntentId, quote.id, 'FALLBACK_EXHAUSTED');
    return;
  }
  if (!failedAdapterId) {
    // Without knowing which adapter failed, excluding nothing can loop back
    // onto the same broken route. Funds are still with the sender pre-burn,
    // so marking FAILED is safe (docs/stuck-fund-recovery.md).
    await failDeposit(ctx, quote.depositIntentId, quote.id, 'FAILED_ADAPTER_UNKNOWN');
    return;
  }

  // Partial-route fallback (PRD §Execution & Fallback): if earlier hops
  // confirmed, funds now sit in an intermediate (chain, token, amount) state.
  // The fallback re-quote must start from that state, not from the original
  // input, or the remaining amount would be double-counted.
  const previous = failedHopIndex > 0 ? route[failedHopIndex - 1] : undefined;
  const prevSettled = previous && (previous.type === 'swap' || previous.type === 'bridge' || previous.type === 'transfer')
    ? previous
    : undefined;
  const mid = prevSettled && prevSettled.amountOut
    ? {
        completedHops: failedHopIndex,
        currentChain: prevSettled.toChain ?? prevSettled.chainId ?? quote.fromChainId,
        currentToken: prevSettled.toToken ?? quote.fromToken,
        currentAmount: prevSettled.amountOut.toString(),
      }
    : undefined;

  await enqueueFallback(ctx, {
    depositId: quote.depositIntentId,
    quoteId: quote.id,
    failedAdapterId,
    attempt: depth + 1,
    ...(mid ?? {}),
  });
}

/** Re-quotes a deposit excluding the failed adapter, or marks it FAILED. */
export async function processFallback(
  job: Job<{
    depositId: string;
    quoteId: string;
    failedAdapterId?: string | null;
    attempt?: number;
    completedHops?: number;
    currentChain?: number;
    currentToken?: string;
    currentAmount?: string;
  }>,
  ctx: WorkerContext,
): Promise<void> {
  const { depositId, quoteId, failedAdapterId } = job.data;
  const [quote, deposit] = await Promise.all([
    ctx.prisma.quote.findUnique({ where: { id: quoteId } }),
    ctx.prisma.depositIntent.findUnique({ where: { id: depositId }, include: { recipient: true } }),
  ]);
  if (!quote || !deposit) return;

  // Depth guard (PRD §Fallback Safety): a deposit may only chain a bounded
  // number of fallback re-quotes before it is marked FAILED.
  const depth = await getFallbackDepth(ctx, quoteId);
  if (depth >= ctx.env.FALLBACK_MAX_DEPTH) {
    await failDeposit(ctx, depositId, quoteId, 'FALLBACK_EXHAUSTED');
    return;
  }
  if (!failedAdapterId) {
    // Excluding nothing risks re-selecting the exact route that just failed.
    await failDeposit(ctx, depositId, quoteId, 'FAILED_ADAPTER_UNKNOWN');
    return;
  }

  // Mid-route fallback state (PRD): the chain/token the funds actually sit on.
  const midRoute = job.data.completedHops && job.data.currentChain && job.data.currentToken && job.data.currentAmount
    ? {
        completedHops: job.data.completedHops,
        currentChain: job.data.currentChain,
        currentToken: job.data.currentToken,
        currentAmount: BigInt(job.data.currentAmount),
      }
    : undefined;
  const fromChainId = midRoute?.currentChain ?? quote.fromChainId;
  const fromToken = midRoute?.currentToken ?? quote.fromToken;
  const fromAmount = midRoute?.currentAmount ?? BigInt(quote.fromAmount.toString());

  // The effective source state the fallback adapters are built for. For a
  // mid-route fallback this is the intermediate chain/token/amount.
  const routeQuote = { ...quote, fromChainId, fromToken, fromAmount };

  const sourceContracts = routeQuote.fromChainId === 11155111
    ? { dex: ctx.env.PAYMESH_SEPOLIA_DEX_ADDRESS, bridge: ctx.env.PAYMESH_SEPOLIA_BRIDGE_ADDRESS }
    : routeQuote.fromChainId === 84532
      ? { dex: ctx.env.PAYMESH_BASE_SEPOLIA_DEX_ADDRESS, bridge: ctx.env.PAYMESH_BASE_SEPOLIA_BRIDGE_ADDRESS }
      : { dex: ctx.env.PAYMESH_DEX_ADDRESS, bridge: ctx.env.PAYMESH_BRIDGE_ADDRESS };

  const routeProviders = ctx.env.ROUTE_PROVIDER_URLS
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((baseUrl) => createRouteApiAdapter({ baseUrl, timeoutMs: ctx.env.ROUTE_PROVIDER_TIMEOUT_MS }));
  if (ctx.env.LIFI_ENABLED) {
    routeProviders.push(createLifiRouteProvider({
      baseUrl: ctx.env.LIFI_API_URL,
      apiKey: ctx.env.LIFI_API_KEY || undefined,
      integrator: ctx.env.LIFI_INTEGRATOR,
      timeoutMs: ctx.env.ROUTE_PROVIDER_TIMEOUT_MS,
    }));
  }
  // Delegates to the shared config helper (single source of truth with the
  // API's routing provider) instead of duplicating a per-chain ternary here.
  const mainnetSwap = routeQuote.fromChainId === 11155111 || routeQuote.fromChainId === 84532
    ? { router: '', quoter: '' }
    : mainnetUniswap(routeQuote.fromChainId);
  const routerConfigured = routeQuote.fromChainId === 11155111
    ? !!ctx.env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS ||
      (!!ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && !!ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS)
    : routeQuote.fromChainId === 84532
      ? !!ctx.env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS ||
        (!!ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && !!ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS)
      : !!mainnetSwap.router && !!mainnetSwap.quoter;
  const cctpConfigured = ctx.env.CCTP_ENABLED &&
    !!(routeQuote.fromChainId === 11155111
      ? ctx.env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : cctpTokenMessenger(routeQuote.fromChainId)) &&
    !!getToken(routeQuote.fromChainId, 'USDC')?.address &&
    !!getToken(deposit.toChainId, 'USDC')?.address;
  if ((!sourceContracts.dex && !sourceContracts.bridge && !routerConfigured && !cctpConfigured) && routeProviders.length === 0) {
    await failDeposit(ctx, depositId, quoteId, 'ROUTING_NOT_CONFIGURED');
    return;
  }

  const adapters = createDefaultAdapters({
    rpcUrl: getChain(routeQuote.fromChainId).rpcUrl,
    sourceChainId: routeQuote.fromChainId,
    dexAddress: sourceContracts.dex as Address | undefined,
    bridgeAddress: sourceContracts.bridge as Address | undefined,
    destChainId: deposit.toChainId,
    dexRouterAddress: (routeQuote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS
        : '') as Address | undefined,
    wrappedNative: (routeQuote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_WETH_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_WETH_ADDRESS
      : ctx.env.PAYMESH_WETH_ADDRESS) as Address | undefined,
    uniswapV3RouterAddress: (routeQuote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
        : mainnetSwap.router) as Address | undefined,
    uniswapV3QuoterAddress: (routeQuote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
        : mainnetSwap.quoter) as Address | undefined,
    cctpTokenMessenger: (routeQuote.fromChainId === 11155111
      ? ctx.env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : routeQuote.fromChainId === 84532
        ? ctx.env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS
        : cctpTokenMessenger(routeQuote.fromChainId)) as Address | undefined,
    sourceUsdc: getToken(routeQuote.fromChainId, 'USDC')?.address as Address | undefined,
    destinationUsdc: getToken(deposit.toChainId, 'USDC')?.address as Address | undefined,
    cctpEnabled: ctx.env.CCTP_ENABLED,
    cctpDestinationDomain: cctpDomain(deposit.toChainId),
    cctpMaxFee: ctx.env.CCTP_MAX_FEE,
    cctpMinFinalityThreshold: ctx.env.CCTP_MIN_FINALITY_THRESHOLD,
    allowMock: ctx.env.PAYMESH_ALLOW_MOCK_ROUTES,
    env: ctx.env,
  });

  const request: QuoteRequest = {
    fromChain: routeQuote.fromChainId,
    fromToken: routeQuote.fromToken,
    fromAmount: BigInt(routeQuote.fromAmount.toString()),
    toChain: deposit.toChainId,
    toToken: deposit.toToken,
    fromAddress: (quote.fromAddress ?? undefined) as Address | undefined,
    toAddress: (quote.toAddress ?? deposit.recipient.walletAddress) as Address,
    slippageBps: quote.slippageBps,
  };

  let result;
  try {
    const fallbackDeps = { ...adapters, routeProviders, metrics: ctx.routingMetrics };
    result = midRoute
      ? await getFallbackQuoteFromHop(
          request,
          fallbackDeps,
          [failedAdapterId],
          midRoute,
        )
      : await getFallbackQuote(
          request,
          fallbackDeps,
          [failedAdapterId],
        );
  } catch (error) {
    if ((error as { code?: string }).code === 'ROUTE_NOT_FOUND') {
      await failDeposit(ctx, depositId, quoteId, 'ROUTE_NOT_FOUND');
      return;
    }
    throw error;
  }

  const newQuoteId = generateId('qt');
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000);
  const best = result.best;

  await ctx.prisma.$transaction(async (tx) => {
    const providerChain = [...new Set(best.route.map((hop) => hop.protocol).filter((p): p is string => !!p))].join('+');
    // Normalized Route entity (Next-Gen Routing PRD §Data Model). Created
    // first; the fallback quote attaches it via `routeId`.
    const route = await tx.route.create({
      data: {
        id: generateId('rt'),
        steps: stringifyBigInts(best.route) as object,
        providerChain: providerChain || (best.adapterId ?? null),
      },
    });
    await tx.quote.create({
      data: {
        id: newQuoteId,
        depositIntentId: depositId,
        fromChainId: routeQuote.fromChainId,
        fromToken: routeQuote.fromToken,
        fromAmount: request.fromAmount.toString(),
        fromAddress: quote.fromAddress,
        toAddress: quote.toAddress,
        routePath: stringifyBigInts(best.route) as object,
        estimatedFee: best.estimatedFee.toString(),
        estimatedTimeSeconds: best.estimatedTimeSeconds,
        estimatedOutput: best.estimatedOutput.toString(),
        slippageBps: best.slippageBps,
        reliability: best.reliability,
        transactionRequest: stringifyBigInts(best.transactionRequest) as object,
        hopTransactionRequests: stringifyBigInts(best.hopTransactionRequests ?? []) as object,
        status: 'ACTIVE',
        expiresAt,
        // Provider KPI columns (PRD §Monitoring).
        providerId: best.adapterId ?? null,
        simulated: false,
        routeId: route.id,
        ...(midRoute
          ? { fallbackFromQuoteId: quoteId, fallbackFromHop: midRoute.completedHops }
          : {}),
      },
    });
    for (let i = 0; i < best.route.length; i++) {
      const hop = best.route[i]!;
      await tx.transaction.create({
        data: {
          id: generateId('tx'),
          quoteId: newQuoteId,
          depositIntentId: depositId,
          hopIndex: i,
          chainId: hop.chainId ?? routeQuote.fromChainId,
          status: 'PENDING',
        },
      });
    }
    await tx.quote.update({ where: { id: quoteId }, data: { status: 'REJECTED' } });
    await tx.depositIntent.update({ where: { id: depositId }, data: { status: 'AWAITING_SIGNATURE' } });
  });

  await emitEvent(ctx, {
    clientId: deposit.clientId,
    type: 'quote.ready',
    payload: { depositId, quoteId: newQuoteId, fallbackFrom: quoteId },
    depositIntentId: depositId,
  });
}

export async function failDeposit(
  ctx: WorkerContext,
  depositId: string,
  quoteId: string,
  errorCode: string,
): Promise<void> {
  await ctx.prisma.depositIntent.update({ where: { id: depositId }, data: { status: 'FAILED' } });
  const deposit = await ctx.prisma.depositIntent.findUnique({ where: { id: depositId } });
  if (deposit) {
    await emitEvent(ctx, {
      clientId: deposit.clientId,
      type: 'deposit.failed',
      payload: { depositId, quoteId, errorCode },
      depositIntentId: depositId,
    });
  }
}
