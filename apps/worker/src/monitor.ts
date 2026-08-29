import { Job } from 'bullmq';
import { createPublicClient, createWalletClient, http, parseEventLogs, type Address, type Hex, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain, MIN_CONFIRMATIONS, QUOTE_TTL_SECONDS } from '@paymesh/config';
import { generateId } from '@paymesh/db';
import { readArtifact } from '@paymesh/contracts';
import {
  getFallbackQuote,
  createDefaultAdapters,
  type QuoteRequest,
} from '@paymesh/routing-engine';
import { WorkerContext, emitEvent, enqueueFallback } from './context';
import { viemChain } from './viem';
import { stringifyBigInts } from './json';
import type { RouteHopLike } from './types';

const BRIDGE_ABI = readArtifact('MockBridge').abi;

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

  if (transaction.status !== 'SUBMITTED' || !transaction.txHash) {
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
    await triggerFallback(ctx, transaction.quote, transaction.hopIndex);
    return;
  }

  if (receipt.status === 'reverted') {
    await ctx.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'FAILED', errorCode: 'TX_REVERTED' },
    });
    await triggerFallback(ctx, transaction.quote, transaction.hopIndex);
    return;
  }

  await ctx.prisma.transaction.update({
    where: { id: transaction.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
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

  const route = (transaction.quote.routePath as unknown as RouteHopLike[]) ?? [];
  const hop = route[transaction.hopIndex];
  const nextHopIndex = transaction.hopIndex + 1;

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
    await settleBridge(ctx, transaction.quote as never, hop, transaction.txHash as Hex);
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
  await destClient.waitForTransactionReceipt({ hash: settleHash, timeout: ctx.env.TX_MONITOR_TIMEOUT_MS });

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

  if (!ctx.env.PAYMESH_DEX_ADDRESS || !ctx.env.PAYMESH_BRIDGE_ADDRESS) {
    await failDeposit(ctx, depositId, quoteId, 'ROUTING_NOT_CONFIGURED');
    return;
  }

  const adapters = createDefaultAdapters({
    rpcUrl: getChain(quote.fromChainId).rpcUrl,
    sourceChainId: quote.fromChainId,
    dexAddress: ctx.env.PAYMESH_DEX_ADDRESS as Address,
    bridgeAddress: ctx.env.PAYMESH_BRIDGE_ADDRESS as Address,
    destChainId: deposit.toChainId,
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
    result = await getFallbackQuote(request, adapters, failedAdapterId ? [failedAdapterId] : []);
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