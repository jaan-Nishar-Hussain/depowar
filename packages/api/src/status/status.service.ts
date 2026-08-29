import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  async get(clientId: string, depositId: string): Promise<unknown> {
    const deposit = await this.prisma.depositIntent.findFirst({
      where: { id: depositId, clientId },
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
}