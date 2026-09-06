import { Job } from 'bullmq';
import { createPublicClient, http, isAddress, parseEventLogs, type Address, type Hex, type Log } from 'viem';
import { cctpDomain, cctpMessageTransmitter, getChain, MIN_CONFIRMATIONS } from '@paymesh/config';
import { generateId } from '@paymesh/db';
import { readArtifact } from '@paymesh/contracts';
import { createPrivateKeySigner } from '@paymesh/routing-engine';
import { WorkerContext, emitEvent } from './context';
import { viemChain } from './viem';
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

interface SettlementJobData {
  transactionId: string;
}

/**
 * Destination settlement worker (PRD §Execution & Fallback: "bridge tx,
 * monitor its attestation and mint on dest"). Runs on its own queue so a long
 * CCTP attestation wait never occupies the single-concurrency tx-monitor.
 *
 * Retry semantics: a job throws when the attestation is not ready or the
 * destination receipt is still pending; BullMQ retries with backoff. When a
 * deposit is burned-in-flight and the job eventually exhausts its attempts,
 * the periodic recovery sweep re-enqueues it — a burn is attestable
 * indefinitely, so it must never be marked FAILED (docs/stuck-fund-recovery.md).
 */
export async function processSettlement(job: Job<SettlementJobData>, ctx: WorkerContext): Promise<void> {
  const transaction = await ctx.prisma.transaction.findUnique({
    where: { id: job.data.transactionId },
    include: { quote: { include: { depositIntent: true } } },
  });
  if (!transaction) return;
  if (transaction.status !== 'SETTLEMENT_PENDING' || !transaction.txHash) return;

  const route = (transaction.quote.routePath as unknown as RouteHopLike[]) ?? [];
  const hop = route[transaction.hopIndex];
  const quote = transaction.quote as never;
  const txHash = transaction.txHash as Hex;

  if (hop?.type === 'bridge') {
    if (hop.protocol?.startsWith('mock-bridge-')) {
      await settleBridge(ctx, quote, hop, txHash);
    } else if (hop.protocol?.startsWith('cctp-v2-')) {
      await settleCctp(ctx, quote, hop, txHash);
    } else {
      await waitForDestinationSettlement(ctx, quote, hop);
    }
  } else if (hop?.type === 'transfer') {
    await waitForDestinationSettlement(ctx, quote, hop);
  }

  await ctx.prisma.depositIntent.update({
    where: { id: transaction.depositIntentId },
    data: { status: 'SETTLED' },
  });
  await ctx.prisma.transaction.update({
    where: { id: transaction.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), settledAt: new Date() },
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
 * destination gas for MessageTransmitterV2.receiveMessage.
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

  const sourceDomain = cctpDomain(hop.fromChain ?? 0);
  const destinationChain = hop.toChain ?? quote.depositIntent.toChainId;
  const transmitter = cctpMessageTransmitter(destinationChain) as Address;
  if (!transmitter) throw new Error(`CCTP message transmitter is not configured for chain ${destinationChain}`);

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
  const signer = createPrivateKeySigner(relayerKey);
  const destinationClient = createPublicClient({
    chain: viemChain(destinationChain),
    transport: http(destinationInfo.rpcUrl),
  });
  const nonce = await destinationClient.getTransactionCount({
    address: signer.address,
    blockTag: 'pending',
  });
  const walletClient = signer.walletClient(viemChain(destinationChain), destinationInfo.rpcUrl);
  const settleHash = await walletClient.writeContract({
    address: transmitter,
    abi: CCTP_MESSAGE_TRANSMITTER_V2_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
    account: walletClient.account!,
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

  const walletClient = createPrivateKeySigner(relayerKey).walletClient(viemChain(hop.toChain ?? 0), destChain.rpcUrl);
  const amount = BigInt(String(hop.amountOut ?? 0n));
  const settleHash = await walletClient.writeContract({
    address: destBridgeAddress,
    abi: BRIDGE_ABI,
    functionName: 'settle',
    account: walletClient.account!,
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