import { Inject, Injectable } from '@nestjs/common';
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppEnv, QUOTE_TTL_SECONDS } from '@paymesh/config';
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
      slippageBps: best.slippageBps,
      transactionRequest: best.transactionRequest,
      expiresAt,
      alternates: alternates.map((a) => ({
        adapterId: a.adapterId,
        estimatedOutput: a.estimatedOutput.toString(),
        estimatedTimeSeconds: a.estimatedTimeSeconds,
      })),
    };
  }

  /** Server-custody single-call sign + submit flow (optional). */
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

    const txReq = quote.transactionRequest as unknown as TransactionRequest;
    const chain = viemChain(quote.fromChainId);
    const walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain,
      transport: http(chain.rpcUrls.default.http[0]!),
    });
    const hash = await walletClient.sendTransaction({
      account: privateKeyToAccount(privateKey),
      to: txReq.to,
      data: txReq.data,
      value: BigInt(txReq.value),
    });

    const hop = await this.prisma.transaction.findFirst({ where: { quoteId, hopIndex: 0 } });
    if (hop) {
      await this.prisma.transaction.update({
        where: { id: hop.id },
        data: { txHash: hash, status: 'SUBMITTED', submittedAt: new Date() },
      });
      await this.queue.enqueue(QUEUE_TX_MONITOR, 'monitor', { transactionId: hop.id });
    }
    await this.prisma.depositIntent.update({
      where: { id: quote.depositIntentId },
      data: { status: 'IN_FLIGHT' },
    });
    await this.events.emit(
      clientId,
      'tx.submitted',
      { depositId: quote.depositIntentId, quoteId, hopIndex: 0, txHash: hash },
      quote.depositIntentId,
    );

    return { quoteId, txHash: hash };
  }

  /** Records a sender-signed tx for a hop so the worker can monitor it. */
  async reportSubmission(clientId: string, quoteId: string, dto: ReportTransactionDto) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, depositIntent: { clientId } },
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
    if (hop.status === 'CONFIRMED' || hop.status === 'SUBMITTED') {
      throw new PayMeshError(
        'TX_ALREADY_SUBMITTED',
        `Hop ${dto.hopIndex} already submitted`,
        'This transaction was already submitted.',
        409,
      );
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
    await this.queue.enqueue(QUEUE_TX_MONITOR, 'monitor', { transactionId: hop.id });

    return { transactionId: hop.id, status: 'SUBMITTED' };
  }
}