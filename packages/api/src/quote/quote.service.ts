import { Inject, Injectable } from '@nestjs/common';
import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppEnv, getChain, QUOTE_TTL_SECONDS } from '@paymesh/config';
import { Prisma, generateId } from '@paymesh/db';
import type { QuoteRequest, TransactionRequest } from '@paymesh/routing-engine';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';
import { stringifyBigInts } from '../common/serialize';
import { viemChain } from '../common/chains';
import { ENV, ROUTING_PROVIDER, SCREENING_PROVIDER } from '../common/tokens';
import { EventService } from '../queue/event.service';
import { QueueService, QUEUE_TX_MONITOR, QUEUE_QUOTE_EXPIRY } from '../queue/queue.service';
import { ScreeningProvider } from '../screening/screening.service';
import type { RoutingProvider } from './routing.provider';
import type { QuoteQueryDto, ReportTransactionDto } from './dto';

const ERC20_BALANCE_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const;

@Injectable()
export class QuoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventService) private readonly events: EventService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(SCREENING_PROVIDER) private readonly screening: ScreeningProvider,
  ) {}

  async quote(clientId: string, query: QuoteQueryDto) {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: query.depositId, clientId },
      include: { recipient: true },
    });
    if (!deposit) {
      throw new PayMeshError(
        'DEPOSIT_NOT_FOUND',
        `Deposit ${query.depositId} not found`,
        'The deposit does not exist.',
        404,
      );
    }

    const toAddress = (query.toAddress ?? deposit.recipient.walletAddress) as Address;
    const screening = await this.screening.screen({
      fromAddress: query.fromAddress,
      toAddress,
      walletAddress: deposit.recipient.walletAddress,
    });
    if (!screening.allowed) {
      throw new PayMeshError(
        'SCREENING_BLOCKED',
        `Address blocked by screening: ${screening.reason}`,
        'This address is not permitted to receive or send deposits.',
        403,
      );
    }

    const request: QuoteRequest = {
      fromChain: query.fromChain,
      fromToken: query.fromToken,
      fromAmount: BigInt(query.fromAmount),
      toChain: deposit.toChainId,
      toToken: deposit.toToken,
      fromAddress: query.fromAddress as Address | undefined,
      toAddress,
      slippageBps: query.slippageBps,
    };

    const { best, alternates } = await this.routing.getQuote(request);
    if (
      !best.hopTransactionRequests ||
      best.hopTransactionRequests.length === 0 ||
      best.hopTransactionRequests.length !== best.route.length
    ) {
      throw new PayMeshError(
        'QUOTE_NOT_EXECUTABLE',
        'The selected provider returned an incomplete execution plan',
        'This route is currently unavailable for execution. Try again or choose another route.',
        503,
      );
    }
    const settlementBaseline = await this.readSettlementBaseline(request.toChain, request.toToken, toAddress);
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000);
    const quoteId = generateId('qt');

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.create({
        data: {
          id: quoteId,
          depositIntentId: deposit.id,
          fromChainId: request.fromChain,
          fromToken: request.fromToken,
          fromAmount: request.fromAmount.toString(),
          fromAddress: request.fromAddress,
          toAddress: request.toAddress,
          routePath: stringifyBigInts(best.route) as Prisma.InputJsonValue,
          estimatedFee: best.estimatedFee.toString(),
          estimatedTimeSeconds: best.estimatedTimeSeconds,
          estimatedOutput: best.estimatedOutput.toString(),
          slippageBps: best.slippageBps,
          reliability: best.reliability,
          settlementBaseline: settlementBaseline?.toString() ?? null,
          transactionRequest: stringifyBigInts(best.transactionRequest) as Prisma.InputJsonValue,
          hopTransactionRequests: stringifyBigInts(
            best.hopTransactionRequests ?? [],
          ) as Prisma.InputJsonValue,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      for (let i = 0; i < best.route.length; i++) {
        const hop = best.route[i]!;
        await tx.transaction.create({
          data: {
            id: generateId('tx'),
            quoteId,
            depositIntentId: deposit.id,
            hopIndex: i,
            chainId: hop.chainId ?? request.fromChain,
            status: 'PENDING',
          },
        });
      }
    });

    // Only the newest quote stays active for a deposit.
    await this.prisma.quote.updateMany({
      where: { depositIntentId: deposit.id, id: { not: quoteId }, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    await this.prisma.depositIntent.update({
      where: { id: deposit.id },
      data: { status: 'AWAITING_SIGNATURE' },
    });

    await this.events.emit(clientId, 'quote.ready', { depositId: deposit.id, quoteId }, deposit.id);

    await this.queue.enqueue(QUEUE_QUOTE_EXPIRY, 'expire', { quoteId }, { delay: QUOTE_TTL_SECONDS * 1000 });

    return {
      quoteId,
      depositId: deposit.id,
      route: best.route,
      hopTransactionRequests: best.hopTransactionRequests ?? [],
      estimatedOutput: best.estimatedOutput.toString(),
      estimatedTimeSeconds: best.estimatedTimeSeconds,
      estimatedFee: best.estimatedFee.toString(),
      reliability: best.reliability,
      liquidityScore: best.liquidityScore,
      priceImpactBps: best.priceImpactBps,
      gasCost: best.gasCost?.toString(),
      bridgeFee: best.bridgeFee?.toString(),
      available: best.available,
      providerMetadata: best.providerMetadata,
      slippageBps: best.slippageBps,
      transactionRequest: best.transactionRequest,
      expiresAt,
      alternates: alternates.map((a) => ({
        adapterId: a.adapterId,
        estimatedOutput: a.estimatedOutput.toString(),
        estimatedTimeSeconds: a.estimatedTimeSeconds,
        estimatedFee: a.estimatedFee.toString(),
        liquidityScore: a.liquidityScore,
        priceImpactBps: a.priceImpactBps,
        reliability: a.reliability,
      })),
    };
  }

  /**
   * Server-custody execution flow (optional). The signer still never receives
   * funds: it only broadcasts the exact quoted calls, one hop at a time. All
   * non-final hops are confirmed before the next call is sent; the final hop
   * is handed to the worker for normal settlement verification.
   */
  async executeServerCustody(clientId: string, quoteId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, depositIntent: { clientId } },
      include: { depositIntent: true },
    });
    if (!quote) {
      throw new PayMeshError('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`, 'The quote does not exist.', 404);
    }
    if (quote.status !== 'ACTIVE' || quote.expiresAt < new Date()) {
      await this.prisma.quote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } }).catch(() => undefined);
      throw new PayMeshError(
        'QUOTE_EXPIRED',
        'Quote is no longer active',
        'This quote has expired. Request a new one.',
        409,
      );
    }

    const privateKey = this.env.EXECUTION_PRIVATE_KEY as Hex | '';
    if (!privateKey) {
      throw new PayMeshError(
        'SIGNER_NOT_CONFIGURED',
        'Server-side execution requires EXECUTION_PRIVATE_KEY',
        'Execution is not enabled for this deployment.',
        501,
      );
    }

    const txRequests = (quote.hopTransactionRequests as unknown as TransactionRequest[]) ?? [];
    const hops = await this.prisma.transaction.findMany({ where: { quoteId }, orderBy: { hopIndex: 'asc' } });
    if (txRequests.length === 0 || txRequests.length !== hops.length) {
      throw new PayMeshError('QUOTE_NOT_EXECUTABLE', 'Quote has no complete execution plan', 'This quote cannot be executed.', 409);
    }
    const account = privateKeyToAccount(privateKey);
    let finalHash: Hex | undefined;
    for (let i = 0; i < txRequests.length; i++) {
      const txReq = txRequests[i]!;
      const row = hops[i]!;
      if (row.status === 'CONFIRMED' && row.txHash) continue;
      const chainId = txReq.chainId ?? quote.fromChainId;
      const chain = viemChain(chainId);
      const walletClient = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]!) });
      const hash = await walletClient.sendTransaction({
        account,
        to: txReq.to,
        data: txReq.data as Hex,
        value: BigInt(txReq.value),
        chainId,
      });
      finalHash = hash;
      await this.prisma.transaction.update({
        where: { id: row.id },
        data: { txHash: hash, status: 'SUBMITTED', submittedAt: new Date() },
      });
      await this.events.emit(
        clientId,
        'tx.submitted',
        { depositId: quote.depositIntentId, quoteId, hopIndex: i, txHash: hash },
        quote.depositIntentId,
      );
      if (i < txRequests.length - 1) {
        const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]!) });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: this.env.TX_MONITOR_TIMEOUT_MS });
        if (receipt.status === 'reverted') {
          await this.prisma.transaction.update({ where: { id: row.id }, data: { status: 'FAILED', errorCode: 'TX_REVERTED' } });
          throw new PayMeshError('TX_REVERTED', `Server-custody hop ${i} reverted`, 'The route transaction reverted. Request a new quote.', 409);
        }
        await this.prisma.transaction.update({ where: { id: row.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      }
    }
    await this.prisma.depositIntent.update({
      where: { id: quote.depositIntentId },
      data: { status: 'IN_FLIGHT' },
    });
    const finalRow = hops[hops.length - 1];
    if (finalRow && finalHash) {
      await this.queue.enqueue(QUEUE_TX_MONITOR, 'monitor', { transactionId: finalRow.id }, {
        attempts: 10,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    }
    return { quoteId, txHash: finalHash };
  }

  /** Records a sender-signed tx for a hop so the worker can monitor it. */
  async reportSubmission(clientId: string, quoteId: string, dto: ReportTransactionDto) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, depositIntent: { clientId } },
      include: { transactions: { orderBy: { hopIndex: 'asc' } } },
    });
    if (!quote) {
      throw new PayMeshError('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`, 'The quote does not exist.', 404);
    }

    const hop = await this.prisma.transaction.findFirst({
      where: { quoteId, hopIndex: dto.hopIndex },
    });
    if (!hop) {
      throw new PayMeshError('HOP_NOT_FOUND', `Hop ${dto.hopIndex} not found`, 'This route hop does not exist.', 404);
    }
    if (quote.status !== 'ACTIVE' || quote.expiresAt < new Date()) {
      throw new PayMeshError(
        'QUOTE_EXPIRED',
        `Quote ${quoteId} is no longer active`,
        'This quote has expired. Request a new quote before submitting a transaction.',
        409,
      );
    }
    const previous = quote.transactions.filter((tx) => tx.hopIndex < dto.hopIndex);
    if (previous.some((tx) => tx.status !== 'CONFIRMED')) {
      throw new PayMeshError(
        'HOP_OUT_OF_ORDER',
        `Hop ${dto.hopIndex} was submitted before the previous hop confirmed`,
        'Wait for the previous transaction to confirm before continuing.',
        409,
      );
    }
    if (hop.status === 'CONFIRMED' || hop.status === 'SUBMITTED') {
      throw new PayMeshError(
        'TX_ALREADY_SUBMITTED',
        `Hop ${dto.hopIndex} already submitted`,
        'This transaction was already submitted.',
        409,
      );
    }

    if (this.env.TX_VALIDATION_ENABLED) {
      await this.validateSubmittedTransaction(quote, dto.hopIndex, dto.txHash);
    }

    await this.prisma.transaction.update({
      where: { id: hop.id },
      data: { txHash: dto.txHash, status: 'SUBMITTED', submittedAt: new Date() },
    });
    await this.prisma.depositIntent.update({
      where: { id: quote.depositIntentId },
      data: { status: 'IN_FLIGHT' },
    });
    await this.events.emit(
      clientId,
      'tx.submitted',
      { depositId: quote.depositIntentId, quoteId, hopIndex: dto.hopIndex, txHash: dto.txHash },
      quote.depositIntentId,
    );
    await this.queue.enqueue(QUEUE_TX_MONITOR, 'monitor', { transactionId: hop.id }, {
      attempts: 10,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    return { transactionId: hop.id, status: 'SUBMITTED' };
  }

  /**
   * Prevents a client from attaching an unrelated transaction hash to a quote.
   * The hash must be visible on the expected chain and match the exact
   * recipient, calldata, value, and sender returned by the quote.
   */
  private async validateSubmittedTransaction(
    quote: {
      fromChainId: number;
      fromAddress: string | null;
      hopTransactionRequests: unknown;
    },
    hopIndex: number,
    txHash: string,
  ): Promise<void> {
    const expected = (quote.hopTransactionRequests as Array<{
      to?: string;
      data?: string;
      value?: string | number;
      chainId?: number;
      from?: string;
    }> | null)?.[hopIndex];
    if (!expected?.to || !expected.data) {
      throw new PayMeshError(
        'QUOTE_NOT_EXECUTABLE',
        `Quote does not contain an executable transaction for hop ${hopIndex}`,
        'This route cannot be executed yet. Request a fresh quote.',
        409,
      );
    }
    const chainId = expected.chainId ?? quote.fromChainId;
    const publicClient = createPublicClient({
      chain: viemChain(chainId),
      transport: http(getChain(chainId).rpcUrl),
    });
    let transaction;
    try {
      transaction = await publicClient.getTransaction({ hash: txHash as Hex });
    } catch {
      throw new PayMeshError(
        'TX_NOT_FOUND',
        `Transaction ${txHash} was not found on chain ${chainId}`,
        'The transaction is not visible on the expected network yet. Wait a moment and retry.',
        409,
      );
    }
    const expectedFrom = expected.from ?? quote.fromAddress;
    const same = (a: string | undefined, b: string | undefined) =>
      !!a && !!b && a.toLowerCase() === b.toLowerCase();
    if (
      transaction.chainId !== undefined && transaction.chainId !== chainId ||
      !same(transaction.to ?? undefined, expected.to) ||
      transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
      transaction.value !== BigInt(String(expected.value ?? 0)) ||
      (expectedFrom && !same(transaction.from, expectedFrom))
    ) {
      throw new PayMeshError(
        'TX_DOES_NOT_MATCH_QUOTE',
        `Transaction ${txHash} does not match quote ${quote.fromChainId}`,
        'The submitted transaction does not match the quoted route. Request a new quote.',
        409,
        { chainId, hopIndex },
      );
    }
  }

  private async readSettlementBaseline(
    chainId: number,
    token: string,
    recipient: Address,
  ): Promise<bigint | undefined> {
    try {
      const chain = getChain(chainId);
      const client = createPublicClient({ chain: viemChain(chainId), transport: http(chain.rpcUrl) });
      if (token === 'native') return await client.getBalance({ address: recipient });
      if (!isAddress(token)) return undefined;
      return await client.readContract({
        address: token,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [recipient],
      });
    } catch {
      // A provider can be temporarily unavailable during quoting. Settlement
      // verification remains enabled and will use the zero baseline fallback.
      return undefined;
    }
  }
}
