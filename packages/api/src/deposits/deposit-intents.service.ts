import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';
import { generateId } from '@paymesh/db';
import { AuditService } from '../audit/audit.service';
import { EventService } from '../queue/event.service';
import { ENV } from '../common/tokens';
import { AppEnv, getDestinationChainIds, getChain } from '@paymesh/config';
import type { CreateDepositIntentDto } from './dto';

@Injectable()
export class DepositIntentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventService) private readonly events: EventService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async create(clientId: string, dto: CreateDepositIntentDto) {
    const destinationChainIds = getDestinationChainIds(this.env);
    if (!destinationChainIds.includes(dto.toChain)) {
      throw new PayMeshError(
        'INVALID_DESTINATION_CHAIN',
        `Destination chain ${dto.toChain} is not enabled. Enabled chains: ${destinationChainIds.join(', ')}`,
        'This destination chain is not enabled for this Depowar integration.',
        400,
      );
    }
    try {
      getChain(dto.toChain);
    } catch {
      throw new PayMeshError(
        'UNSUPPORTED_CHAIN',
        `Destination chain ${dto.toChain} is not in the Depowar chain registry`,
        'This destination chain is not supported by Depowar.',
        400,
      );
    }
    const recipient = await this.prisma.recipient.findFirst({
      where: { id: dto.recipientId, clientId },
    });
    if (!recipient) {
      throw new PayMeshError(
        'RECIPIENT_NOT_FOUND',
        `Recipient ${dto.recipientId} not found for client`,
        'The recipient does not exist.',
        404,
      );
    }

    const idempotencyKey = dto.idempotencyKey ?? `idem-${generateId('k')}`;
    const existing = await this.prisma.depositIntent.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return { depositId: existing.id, status: existing.status, created: false };
    }

    const deposit = await this.prisma.depositIntent.create({
      data: {
        id: generateId('dep'),
        clientId,
        recipientId: recipient.id,
        idempotencyKey,
        toChainId: dto.toChain,
        toToken: dto.toToken,
        minAmount: dto.minAmount ?? null,
        maxAmount: dto.maxAmount ?? null,
        status: 'PENDING',
      },
    });

    await this.audit.record({
      clientId,
      actor: 'api',
      action: 'deposit-intent.created',
      entityType: 'DepositIntent',
      entityId: deposit.id,
    });

    return { depositId: deposit.id, status: deposit.status, created: true };
  }

  async findOne(clientId: string, depositId: string): Promise<unknown> {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: depositId, clientId },
      include: {
        recipient: true,
        quotes: { orderBy: { createdAt: 'desc' }, take: 5 },
        transactions: true,
      },
    });
    if (!deposit) {
      throw new PayMeshError(
        'DEPOSIT_NOT_FOUND',
        `Deposit ${depositId} not found`,
        'The deposit does not exist.',
        404,
      );
    }
    return deposit;
  }

  async getRecoveryStatus(clientId: string, depositId: string) {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: depositId, clientId },
      include: {
        quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
        transactions: { orderBy: { hopIndex: 'asc' } },
      },
    });
    if (!deposit) {
      throw new PayMeshError('DEPOSIT_NOT_FOUND', `Deposit ${depositId} not found`, 'The deposit does not exist.', 404);
    }

    const confirmedTxs = deposit.transactions.filter((tx) => tx.status === 'CONFIRMED' || tx.status === 'SETTLEMENT_PENDING');
    const hasBridgeTx = deposit.transactions.some((tx) => (tx.status === 'CONFIRMED' || tx.status === 'SETTLEMENT_PENDING') && tx.txHash);
    const isSettled = deposit.status === 'SETTLED';

    let fundsLocation = 'sender_source_chain';
    if (isSettled) {
      fundsLocation = 'recipient_settled';
    } else if (hasBridgeTx) {
      fundsLocation = 'in_flight_bridge';
    }

    return {
      depositId: deposit.id,
      status: deposit.status,
      fundsLocation,
      canRetry: deposit.status === 'FAILED' || deposit.status === 'AWAITING_SIGNATURE' || deposit.status === 'PENDING',
      completedHops: confirmedTxs.length,
      totalHops: deposit.transactions.length,
      refundable: fundsLocation === 'sender_source_chain' && !isSettled,
      instructions: fundsLocation === 'sender_source_chain'
        ? 'Funds never left sender or reverted on source chain. Sender retains full balance.'
        : fundsLocation === 'in_flight_bridge'
          ? 'Funds were burned or locked on bridge rail. Relayer or monitor is processing destination settlement.'
          : 'Funds have been delivered to recipient destination wallet.',
    };
  }

  async retry(clientId: string, depositId: string) {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: depositId, clientId },
      include: {
        transactions: { orderBy: { hopIndex: 'asc' } },
        quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!deposit) {
      throw new PayMeshError('DEPOSIT_NOT_FOUND', `Deposit ${depositId} not found`, 'The deposit does not exist.', 404);
    }
    if (deposit.status === 'SETTLED') {
      throw new PayMeshError('ALREADY_SETTLED', 'Deposit is already settled', 'This deposit has already settled.', 409);
    }

    await this.prisma.depositIntent.update({
      where: { id: deposit.id },
      data: { status: 'PENDING' },
    });

    await this.audit.record({
      clientId,
      actor: 'api',
      action: 'deposit-intent.retried',
      entityType: 'DepositIntent',
      entityId: deposit.id,
    });

    return { depositId: deposit.id, status: 'PENDING', message: 'Deposit reset for retry. Request a fresh quote to proceed.' };
  }
}

