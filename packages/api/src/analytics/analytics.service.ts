import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview(clientId: string, days = 30): Promise<unknown> {
    const windowDays = Number.isFinite(days) ? Math.min(365, Math.max(1, Math.trunc(days))) : 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const deposits = await this.prisma.depositIntent.findMany({
      where: { clientId, createdAt: { gte: since } },
      select: { id: true, status: true, toChainId: true, toToken: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const counts = deposits.reduce<Record<string, number>>((result, deposit) => {
      result[deposit.status] = (result[deposit.status] ?? 0) + 1;
      return result;
    }, {});
    const settled = deposits.filter((deposit) => deposit.status === 'SETTLED');
    const settlementTimes = settled.map((deposit) => deposit.updatedAt.getTime() - deposit.createdAt.getTime());
    return {
      windowDays,
      since,
      totalDeposits: deposits.length,
      statusCounts: counts,
      settledDeposits: settled.length,
      successRate: deposits.length ? settled.length / deposits.length : 0,
      averageSettlementTimeSeconds: settlementTimes.length ? Math.round(settlementTimes.reduce((a, b) => a + b, 0) / settlementTimes.length / 1000) : 0,
      destinations: [...new Set(deposits.map((deposit) => deposit.toChainId))],
      recentDeposits: deposits.slice(0, 20),
    };
  }
}
