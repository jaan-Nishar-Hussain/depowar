import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayMeshError } from '../common/errors';
import { generateId } from '@paymesh/db';
import type { SettlementUpdateDto } from './dto';

@Injectable()
export class RecipientsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(clientId: string, id: string): Promise<unknown> {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id, clientId },
      include: { settlementConfigs: { where: { enabled: true } } },
    });
    if (!recipient) {
      throw new PayMeshError('RECIPIENT_NOT_FOUND', `Recipient ${id} not found`, 'The recipient does not exist.', 404);
    }
    return recipient;
  }

  async updateSettlement(clientId: string, id: string, dto: SettlementUpdateDto): Promise<unknown> {
    const recipient = await this.prisma.recipient.findFirst({ where: { id, clientId } });
    if (!recipient) {
      throw new PayMeshError('RECIPIENT_NOT_FOUND', `Recipient ${id} not found`, 'The recipient does not exist.', 404);
    }

    const config = await this.prisma.settlementConfig.create({
      data: {
        id: generateId('cfg'),
        recipientId: recipient.id,
        chainId: dto.chainId,
        token: dto.token,
        settlementType: dto.settlementType,
        contractAddress: dto.contractAddress,
        minAmount: dto.minAmount ?? null,
        maxAmount: dto.maxAmount ?? null,
      },
    });

    await this.audit.record({
      clientId,
      actor: 'api',
      action: 'recipient.settlement.updated',
      entityType: 'Recipient',
      entityId: recipient.id,
      details: { configId: config.id, chainId: dto.chainId, token: dto.token },
    });

    return config;
  }
}