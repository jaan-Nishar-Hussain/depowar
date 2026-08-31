import { Job } from 'bullmq';
import { createPublicClient, createWalletClient, http, isAddress, parseEventLogs, type Address, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { cctpDomain, cctpMessageTransmitter, cctpTokenMessenger, getChain, getToken, MIN_CONFIRMATIONS, QUOTE_TTL_SECONDS } from '@paymesh/config';
import { generateId } from '@paymesh/db';
import { readArtifact } from '@paymesh/contracts';
import {
  getFallbackQuote,
  createDefaultAdapters,
  createRouteApiAdapter,
  createLifiRouteProvider,
  type QuoteRequest,
} from '@paymesh/routing-engine';
import { WorkerContext, emitEvent, enqueueFallback } from './context';
import { viemChain } from './viem';
import { stringifyBigInts } from './json';
import type { RouteHopLike } from './types';

const BRIDGE_ABI = readArtifact('MockBridge').abi;
const ERC20_BALANCE_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const;

const CCTP_MESSAGE_TRANSMITTER_V2_ABI = [{
  type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable',
  inputs: [
    { name: 'message', type: 'bytes' },
    { name: 'attestation', type: 'bytes' },
  ],
  outputs: [{ name: 'success', type: 'bool' }],
}] as const;

function cctpDomainForChain(chainId: number): number {
  return cctpDomain(chainId);
}

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
    // known to be failed is not.
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

  // Terminal hop.
  if (hop?.type === 'bridge') {
    if (hop.protocol?.startsWith('mock-bridge-')) {
      await settleBridge(ctx, transaction.quote as never, hop, transaction.txHash as Hex);
    } else if (hop.protocol?.startsWith('cctp-v2-')) {
      await settleCctp(ctx, transaction.quote as never, hop, transaction.txHash as Hex);
    } else {
      await waitForDestinationSettlement(ctx, transaction.quote as never, hop);
    }
  } else if (hop?.type === 'transfer') {
    await waitForDestinationSettlement(ctx, transaction.quote as never, hop);
  }

  if (terminalSettlement) {
    await ctx.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
  }

  await ctx.prisma.depositIntent.update({
    where: { id: transaction.depositIntentId },
    data: { status: 'SETTLED' },
  });
  await emitEvent(ctx, {
    clientId: transaction.quote.depositIntent.clientId,
    type: 'deposit.settled',
    payload: {
      depositId: transaction.depositIntentId,
      quoteId: transaction.quoteId,
      receivedAmount: transaction.quote.estimatedOutput.toString(),
    },
    depositIntentId: transaction.depositIntentId,
  });
}

/**
 * Completes a Circle CCTP V2 burn. The source burn is user-signed; after it
 * confirms, Iris supplies the attested message and the PayMesh relayer pays
 * Polygon Amoy gas for MessageTransmitterV2.receiveMessage.
 */
async function settleCctp(
  ctx: WorkerContext,
  quote: {
    id: string;
    depositIntentId: string;
    toAddress: string | null;
    settlementBaseline: unknown;
    estimatedOutput: unknown;
    depositIntent: { toChainId: number; toToken: string };
  },
  hop: RouteHopLike,
  sourceTxHash: Hex,
): Promise<void> {
  const existingSettlement = await ctx.prisma.transaction.findFirst({
    where: { quoteId: quote.id, hopIndex: 99, status: 'CONFIRMED' },
  });
  if (existingSettlement) return;
  if (!quote.toAddress) throw new Error('CCTP quote has no destination address');

  const sourceDomain = cctpDomainForChain(hop.fromChain ?? 0);
  const destinationChain = hop.toChain ?? quote.depositIntent.toChainId;
  const transmitter = cctpMessageTransmitter(destinationChain) as Address;
  if (!transmitter) throw new Error(`CCTP message transmitter is not configured for chain ${destinationChain}`);

  // Perform one non-blocking check. A pending/404 response is retried by
  // BullMQ instead of occupying a worker slot during Circle finalization.
  const url = `${ctx.env.CCTP_IRIS_API_URL.replace(/\/$/, '')}/v2/messages/${sourceDomain}?transactionHash=${sourceTxHash}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 404 || response.status === 429) throw new Error('CCTP attestation is not ready');
    throw new Error(`CCTP Iris request failed with HTTP ${response.status}`);
  }
  const body = await response.json() as {
    messages?: Array<{ message?: string; attestation?: string | null; status?: string }>;
  };
  const item = body.messages?.[0];
  const message = item?.message?.startsWith('0x') ? item.message as Hex : undefined;
  const attestation = item?.attestation?.startsWith('0x') && item.attestation !== '0x'
    ? item.attestation as Hex
    : undefined;
  if (!message || !attestation) throw new Error('CCTP attestation is not ready');

  const destinationInfo = getChain(destinationChain);
  const relayerKey = ctx.env.RELAYER_PRIVATE_KEY as Hex;
  if (!relayerKey) throw new Error('RELAYER_PRIVATE_KEY is required for CCTP destination settlement');
  const account = privateKeyToAccount(relayerKey);
  const destinationClient = createPublicClient({
    chain: viemChain(destinationChain),
    transport: http(destinationInfo.rpcUrl),
  });
  // Use the pending nonce so queued/in-flight relayer transactions are
  // included. This avoids reusing a nonce that was already broadcast.
  const nonce = await destinationClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });
  const walletClient = createWalletClient({
    account,
    chain: viemChain(destinationChain),
    transport: http(destinationInfo.rpcUrl),
  });
  const settleHash = await walletClient.writeContract({
    address: transmitter,
    abi: CCTP_MESSAGE_TRANSMITTER_V2_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
    chain: viemChain(destinationChain),
    nonce,
  });
  const receipt = await destinationClient.waitForTransactionReceipt({
    hash: settleHash,
    confirmations: MIN_CONFIRMATIONS,
    timeout: ctx.env.TX_MONITOR_TIMEOUT_MS,
  });
  if (receipt.status === 'reverted') throw new Error('CCTP receiveMessage transaction reverted');

  await waitForDestinationSettlement(ctx, quote, hop);
  await ctx.prisma.transaction.create({
    data: {
      id: generateId('tx'),
      quoteId: quote.id,
      depositIntentId: quote.depositIntentId,
      hopIndex: 99,
      chainId: destinationChain,
      txHash: settleHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    },
  });
}

/**
 * Acts as the mock bridge relayer: reads the TransferInitiated id from the
 * confirmed source tx and calls settle() on the destination-side bridge,
 * paying the recipient. Real bridges settle themselves; this is testnet-only.
 */
async function settleBridge(
  ctx: WorkerContext,
  quote: {
    id: string;
    depositIntentId: string;
    toAddress: string | null;
    routePath: unknown;
  },
  hop: RouteHopLike,
  sourceTxHash: Hex,
): Promise<void> {
  const existingSettlement = await ctx.prisma.transaction.findFirst({
    where: { quoteId: quote.id, hopIndex: 99, status: 'CONFIRMED' },
  });
  if (existingSettlement) return;
  const sourceChain = getChain(hop.fromChain ?? 0);
  const destChain = getChain(hop.toChain ?? 0);
  const sourceClient = createPublicClient({
    chain: viemChain(hop.fromChain ?? 0),
    transport: http(sourceChain.rpcUrl),
  });

  const receipt = await sourceClient.getTransactionReceipt({ hash: sourceTxHash });
  const initiated = parseEventLogs({
    abi: BRIDGE_ABI,
    logs: receipt.logs as Log[],
    eventName: 'TransferInitiated',
  });
  const transferId = (initiated[0]?.args as { id?: bigint } | undefined)?.id;
  if (transferId === undefined) {
    throw new Error('TransferInitiated log not found in bridge deposit receipt');
  }

  const relayerKey = (ctx.env.RELAYER_PRIVATE_KEY || ctx.env.ANVIL_ACCOUNT_PRIVATE_KEY) as Hex;
  const destBridgeAddress = (ctx.env.PAYMESH_DEST_BRIDGE_ADDRESS ||
    ctx.env.PAYMESH_BRIDGE_ADDRESS) as Address;
  if (!destBridgeAddress) {
    throw new Error('PAYMESH_BRIDGE_ADDRESS not configured for settlement');
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(relayerKey),
    chain: viemChain(hop.toChain ?? 0),
    transport: http(destChain.rpcUrl),
  });
  const amount = BigInt(String(hop.amountOut ?? 0n));
  const settleHash = await walletClient.writeContract({
    address: destBridgeAddress,
    abi: BRIDGE_ABI,
    functionName: 'settle',
    args: [
      transferId,
      (hop.toToken ?? '0x0000000000000000000000000000000000000000') as Address,
      amount,
      (quote.toAddress ?? '0x0000000000000000000000000000000000000000') as Address,
    ],
    chain: viemChain(hop.toChain ?? 0),
  });

  const destClient = createPublicClient({
    chain: viemChain(hop.toChain ?? 0),
    transport: http(destChain.rpcUrl),
  });
  const settleReceipt = await destClient.waitForTransactionReceipt({ hash: settleHash, timeout: ctx.env.TX_MONITOR_TIMEOUT_MS });
  if (settleReceipt.status === 'reverted') {
    throw new Error('Destination bridge settlement transaction reverted');
  }
  await waitForDestinationSettlement(ctx, {
    toAddress: quote.toAddress,
    settlementBaseline: null,
    estimatedOutput: amount,
    depositIntent: { toChainId: hop.toChain ?? 0, toToken: hop.toToken ?? '' },
  }, hop);

  await ctx.prisma.transaction.create({
    data: {
      id: generateId('tx'),
      quoteId: quote.id,
      depositIntentId: quote.depositIntentId,
      hopIndex: 99, // settlement marker row (relayer settle)
      chainId: hop.toChain ?? 0,
      txHash: settleHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    },
  });
}

/**
 * Verifies a real bridge/transfer by observing the recipient's destination
 * balance. A source-chain confirmation alone is never treated as settlement.
 */
async function waitForDestinationSettlement(
  ctx: WorkerContext,
  quote: { toAddress: string | null; settlementBaseline: unknown; estimatedOutput: unknown; depositIntent: { toChainId: number; toToken: string } },
  hop: RouteHopLike,
): Promise<void> {
  const chainId = hop.toChain ?? quote.depositIntent.toChainId;
  const token = hop.toToken ?? quote.depositIntent.toToken;
  if (!quote.toAddress) throw new Error('Quote has no destination address for settlement verification');
  const recipient = quote.toAddress as Address;
  const chain = getChain(chainId);
  const client = createPublicClient({ chain: viemChain(chainId), transport: http(chain.rpcUrl) });
  const baseline = quote.settlementBaseline == null ? 0n : BigInt(String(quote.settlementBaseline));
  const expected = baseline + BigInt(String(quote.estimatedOutput));
  const deadline = Date.now() + ctx.env.TX_MONITOR_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const balance = token === 'native'
        ? await client.getBalance({ address: recipient })
        : isAddress(token)
          ? await client.readContract({ address: token, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [recipient] })
          : undefined;
      if (balance !== undefined && balance >= expected) return;
    } catch {
      // Provider/indexer may lag behind the source transaction. Keep polling
      // until the configured monitor timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(ctx.env.TX_MONITOR_POLL_MS, 5_000)));
  }
  throw new Error('Destination settlement was not observed before timeout');
}

async function triggerFallback(
  ctx: WorkerContext,
  quote: { id: string; depositIntentId: string; routePath: unknown },
  failedHopIndex: number,
): Promise<void> {
  const route = (quote.routePath as unknown as RouteHopLike[]) ?? [];
  const failedAdapterId = route[failedHopIndex]?.protocol ?? null;
  await enqueueFallback(ctx, {
    depositId: quote.depositIntentId,
    quoteId: quote.id,
    failedAdapterId,
  });
}

/** Re-quotes a deposit excluding the failed adapter, or marks it FAILED. */
export async function processFallback(
  job: Job<{ depositId: string; quoteId: string; failedAdapterId?: string | null }>,
  ctx: WorkerContext,
): Promise<void> {
  const { depositId, quoteId, failedAdapterId } = job.data;
  const [quote, deposit] = await Promise.all([
    ctx.prisma.quote.findUnique({ where: { id: quoteId } }),
    ctx.prisma.depositIntent.findUnique({ where: { id: depositId }, include: { recipient: true } }),
  ]);
  if (!quote || !deposit) return;

  const sourceContracts = quote.fromChainId === 11155111
    ? { dex: ctx.env.PAYMESH_SEPOLIA_DEX_ADDRESS, bridge: ctx.env.PAYMESH_SEPOLIA_BRIDGE_ADDRESS }
    : quote.fromChainId === 84532
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
  const mainnetSwap = quote.fromChainId === 1
    ? { router: ctx.env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: ctx.env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS }
    : quote.fromChainId === 8453
      ? { router: ctx.env.PAYMESH_BASE_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: ctx.env.PAYMESH_BASE_MAINNET_UNISWAP_V3_QUOTER_ADDRESS }
      : quote.fromChainId === 137
        ? { router: ctx.env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: ctx.env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_QUOTER_ADDRESS }
        : { router: '', quoter: '' };
  const routerConfigured = quote.fromChainId === 11155111
    ? !!ctx.env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS ||
      (!!ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && !!ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS)
    : quote.fromChainId === 84532
      ? !!ctx.env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS ||
        (!!ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && !!ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS)
      : !!mainnetSwap.router && !!mainnetSwap.quoter;
  const cctpConfigured = ctx.env.CCTP_ENABLED &&
    !!(quote.fromChainId === 11155111
      ? ctx.env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : cctpTokenMessenger(quote.fromChainId)) &&
    !!getToken(quote.fromChainId, 'USDC')?.address &&
    !!getToken(deposit.toChainId, 'USDC')?.address;
  if ((!sourceContracts.dex && !sourceContracts.bridge && !routerConfigured && !cctpConfigured) && routeProviders.length === 0) {
    await failDeposit(ctx, depositId, quoteId, 'ROUTING_NOT_CONFIGURED');
    return;
  }

  const adapters = createDefaultAdapters({
    rpcUrl: getChain(quote.fromChainId).rpcUrl,
    sourceChainId: quote.fromChainId,
    dexAddress: sourceContracts.dex as Address | undefined,
    bridgeAddress: sourceContracts.bridge as Address | undefined,
    destChainId: deposit.toChainId,
    dexRouterAddress: (quote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS
        : '') as Address | undefined,
    wrappedNative: (quote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_WETH_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_WETH_ADDRESS
      : ctx.env.PAYMESH_WETH_ADDRESS) as Address | undefined,
    uniswapV3RouterAddress: (quote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
        : mainnetSwap.router) as Address | undefined,
    uniswapV3QuoterAddress: (quote.fromChainId === 11155111
      ? ctx.env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
        : mainnetSwap.quoter) as Address | undefined,
    cctpTokenMessenger: (quote.fromChainId === 11155111
      ? ctx.env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS
      : quote.fromChainId === 84532
        ? ctx.env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS
        : cctpTokenMessenger(quote.fromChainId)) as Address | undefined,
    sourceUsdc: getToken(quote.fromChainId, 'USDC')?.address as Address | undefined,
    destinationUsdc: getToken(deposit.toChainId, 'USDC')?.address as Address | undefined,
    cctpEnabled: ctx.env.CCTP_ENABLED,
    cctpDestinationDomain: cctpDomain(deposit.toChainId),
    cctpMaxFee: ctx.env.CCTP_MAX_FEE,
    cctpMinFinalityThreshold: ctx.env.CCTP_MIN_FINALITY_THRESHOLD,
    allowMock: ctx.env.PAYMESH_ALLOW_MOCK_ROUTES,
  });

  const request: QuoteRequest = {
    fromChain: quote.fromChainId,
    fromToken: quote.fromToken,
    fromAmount: BigInt(quote.fromAmount.toString()),
    toChain: deposit.toChainId,
    toToken: deposit.toToken,
    fromAddress: (quote.fromAddress ?? undefined) as Address | undefined,
    toAddress: (quote.toAddress ?? deposit.recipient.walletAddress) as Address,
    slippageBps: quote.slippageBps,
  };

  let result;
  try {
    result = await getFallbackQuote(
      request,
      { ...adapters, routeProviders },
      failedAdapterId ? [failedAdapterId] : [],
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
    await tx.quote.create({
      data: {
        id: newQuoteId,
        depositIntentId: depositId,
        fromChainId: quote.fromChainId,
        fromToken: quote.fromToken,
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
          chainId: hop.chainId ?? quote.fromChainId,
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

async function failDeposit(
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
