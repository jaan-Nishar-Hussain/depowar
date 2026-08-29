import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';
import { generateId } from '@paymesh/db';
import { AuditService } from '../audit/audit.service';
import { EventService } from '../queue/event.service';
import type { CreateDepositIntentDto } from './dto';

@Injectable()
export class DepositIntentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  async create(clientId: string, dto: CreateDepositIntentDto) {
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
}