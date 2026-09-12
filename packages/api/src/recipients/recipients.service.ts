import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayMeshError } from '../common/errors';
import { generateId } from '@paymesh/db';
import { getChain, getDestinationChainIds, getToken, getTokens, type AppEnv } from '@paymesh/config';
import { ENV } from '../common/tokens';
import { SCREENING_PROVIDER } from '../common/tokens';
import type { ScreeningProvider } from '../screening/screening.service';
import type { CreateRecipientDto, SettlementUpdateDto } from './dto';

@Injectable()
export class RecipientsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(SCREENING_PROVIDER) private readonly screening: ScreeningProvider,
  ) {}

  async list(projectId: string): Promise<unknown> {
    return this.prisma.recipient.findMany({
      where: { projectId },
      include: { settlementConfigs: { where: { enabled: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Returns the project's default receiver for consumer deposit flows. */
  async getDepositConfig(projectId: string): Promise<unknown> {
    return this.prisma.recipient.findFirst({
      where: { projectId },
      include: { settlementConfigs: { where: { enabled: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(projectId: string, dto: CreateRecipientDto): Promise<unknown> {
    const screening = await this.screening.screen({ walletAddress: dto.walletAddress });
    if (!screening.allowed) {
      throw new PayMeshError('FORBIDDEN', 'Receiver screening failed', 'This receiver address cannot be used.', 422);
    }
    try {
      getChain(dto.chainId);
    } catch {
      throw new PayMeshError('UNSUPPORTED_CHAIN', `Chain ${dto.chainId} is not registered`, 'This destination chain is not supported.', 400);
    }
    if (!getDestinationChainIds(this.env).includes(dto.chainId)) {
      throw new PayMeshError('INVALID_DESTINATION_CHAIN', `Chain ${dto.chainId} is not enabled`, 'This destination chain is not enabled for this integration.', 400);
    }
    const requestedToken = dto.token.trim();
    const tokenSymbol = requestedToken.toUpperCase();
    const configuredToken = tokenSymbol === 'NATIVE'
      ? undefined
      : ['USDC', 'USDT'].includes(tokenSymbol)
        ? getToken(dto.chainId, tokenSymbol)
        : getTokens(dto.chainId).find((candidate) => candidate.address?.toLowerCase() === requestedToken.toLowerCase());
    const token = tokenSymbol === 'NATIVE' ? 'native' : configuredToken?.address ?? requestedToken;
    const tokenSupported = token === 'native' || !!configuredToken?.address;
    if (!tokenSupported) {
      throw new PayMeshError('UNSUPPORTED_CHAIN', `Token ${dto.token} is not configured on chain ${dto.chainId}`, 'This destination token is not supported on the selected chain.', 400);
    }
    const recipient = await this.prisma.recipient.create({
      data: {
        id: generateId('rec'),
        projectId,
        walletAddress: dto.walletAddress,
        settlementType: dto.settlementType,
        preferredChainId: dto.chainId,
        preferredToken: token,
        amlStatus: 'CLEAR',
        settlementConfigs: {
          create: {
            id: generateId('cfg'),
            chainId: dto.chainId,
            token,
            settlementType: dto.settlementType,
            contractAddress: dto.contractAddress,
            minAmount: dto.minAmount ?? null,
            maxAmount: dto.maxAmount ?? null,
          },
        },
      },
      include: { settlementConfigs: true },
    });
    await this.audit.record({ projectId, actor: 'api', action: 'recipient.created', entityType: 'Recipient', entityId: recipient.id, details: { chainId: dto.chainId, token } });
    return recipient;
  }

  async get(projectId: string, id: string): Promise<unknown> {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id, projectId },
      include: { settlementConfigs: { where: { enabled: true } } },
    });
    if (!recipient) {
      throw new PayMeshError('RECIPIENT_NOT_FOUND', `Recipient ${id} not found`, 'The recipient does not exist.', 404);
    }
    return recipient;
  }

  async updateSettlement(projectId: string, id: string, dto: SettlementUpdateDto): Promise<unknown> {
    const recipient = await this.prisma.recipient.findFirst({ where: { id, projectId } });
    if (!recipient) {
      throw new PayMeshError('RECIPIENT_NOT_FOUND', `Recipient ${id} not found`, 'The recipient does not exist.', 404);
    }

    try {
      getChain(dto.chainId);
    } catch {
      throw new PayMeshError('UNSUPPORTED_CHAIN', `Chain ${dto.chainId} is not registered`, 'This destination chain is not supported.', 400);
    }
    if (!getDestinationChainIds(this.env).includes(dto.chainId)) {
      throw new PayMeshError('INVALID_DESTINATION_CHAIN', `Chain ${dto.chainId} is not enabled`, 'This destination chain is not enabled for this integration.', 400);
    }

    const requestedToken = dto.token.trim();
    const tokenSymbol = requestedToken.toUpperCase();
    const configuredToken = tokenSymbol === 'NATIVE'
      ? undefined
      : ['USDC', 'USDT'].includes(tokenSymbol)
        ? getToken(dto.chainId, tokenSymbol)
        : getTokens(dto.chainId).find((candidate) => candidate.address?.toLowerCase() === requestedToken.toLowerCase());
    const resolvedToken = tokenSymbol === 'NATIVE' ? 'native' : configuredToken?.address ?? requestedToken;
    if (resolvedToken !== 'native' && !configuredToken?.address) {
      throw new PayMeshError('UNSUPPORTED_CHAIN', `Token ${dto.token} is not configured on chain ${dto.chainId}`, 'This destination token is not supported on the selected chain.', 400);
    }
    const token = tokenSymbol === 'NATIVE' || ['USDC', 'USDT'].includes(tokenSymbol) ? tokenSymbol === 'NATIVE' ? 'native' : tokenSymbol : resolvedToken;

    // Updating a receiver must replace the active destination. Previously this
    // only appended a config, leaving the old config active and leaving the
    // widget to sometimes select the stale chain/token.
    const config = await this.prisma.$transaction(async (tx) => {
      await tx.settlementConfig.updateMany({
        where: { recipientId: recipient.id, enabled: true },
        data: { enabled: false, supersededAt: new Date() },
      });
      await tx.recipient.update({
        where: { id: recipient.id },
        data: {
          preferredChainId: dto.chainId,
          preferredToken: token,
          settlementType: dto.settlementType,
        },
      });
      return tx.settlementConfig.create({
        data: {
          id: generateId('cfg'),
          recipientId: recipient.id,
          chainId: dto.chainId,
          token,
          settlementType: dto.settlementType,
          contractAddress: dto.contractAddress,
          minAmount: dto.minAmount ?? null,
          maxAmount: dto.maxAmount ?? null,
        },
      });
    });

    await this.audit.record({
      projectId,
      actor: 'api',
      action: 'recipient.settlement.updated',
      entityType: 'Recipient',
      entityId: recipient.id,
      details: { configId: config.id, chainId: dto.chainId, token },
    });

    return config;
  }
}
