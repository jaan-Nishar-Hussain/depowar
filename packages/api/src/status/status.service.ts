import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';

@Injectable()
export class StatusService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(projectId: string, depositId: string): Promise<unknown> {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: depositId, projectId },
      include: {
        recipient: true,
        quotes: { orderBy: { createdAt: 'desc' }, take: 10 },
        transactions: { orderBy: { hopIndex: 'asc' } },
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

  async getTransactionById(projectId: string, transactionId: string): Promise<unknown> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, depositIntent: { projectId } },
      include: {
        depositIntent: true,
        quote: true,
      },
    });
    if (!tx) {
      throw new PayMeshError(
        'TRANSACTION_NOT_FOUND',
        `Transaction ${transactionId} not found`,
        'The transaction does not exist.',
        404,
      );
    }
    return tx;
  }

  async listTransactionsByIntent(projectId: string, intentId: string): Promise<unknown> {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: intentId, projectId },
    });
    if (!deposit) {
      throw new PayMeshError(
        'DEPOSIT_NOT_FOUND',
        `Deposit intent ${intentId} not found`,
        'The deposit intent does not exist.',
        404,
      );
    }
    return this.prisma.transaction.findMany({
      where: { depositIntentId: intentId },
      orderBy: { hopIndex: 'asc' },
    });
  }
}