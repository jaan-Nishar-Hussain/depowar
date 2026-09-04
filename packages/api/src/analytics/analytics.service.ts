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

    // Provider KPIs (PRD §Monitoring): breakdown of winning routes by provider
    // plus fallback activity, powered by the Quote KPI columns.
    const quotes = await this.prisma.quote.findMany({
      where: { depositIntent: { clientId } },
      select: { providerId: true, fallbackFromQuoteId: true, createdAt: true, depositIntentId: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const providerBreaks = quotes.reduce<Record<string, number>>((result, quote) => {
      const key = quote.providerId ?? 'unknown';
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
    const fallbackQuotes = quotes.filter((quote) => quote.fallbackFromQuoteId !== null).length;

    // Cost-efficiency KPI (Next-Gen Routing PRD §Success Metrics: "Cost
    // Efficiency: minimize total fees... track average USDC cost per
    // transfer"). A deposit may be re-quoted (expiry, fallback) before one
    // quote is actually executed, so this identifies the executed quote by
    // its transactions having a txHash, not by `Quote.status` — no code path
    // in this codebase currently sets status to the schema's documented
    // 'USED' value, so filtering on it would always return zero rows.
    const settledIds = settled.map((deposit) => deposit.id);
    const candidateQuotes = settledIds.length
      ? await this.prisma.quote.findMany({
          where: { depositIntentId: { in: settledIds }, transactions: { some: { txHash: { not: null } } } },
          select: { depositIntentId: true, estimatedFee: true, estimatedOutput: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const executedQuoteByDeposit = new Map<string, { estimatedFee: unknown; estimatedOutput: unknown }>();
    for (const quote of candidateQuotes) {
      // Already ordered newest-first, so the first hit per deposit is the one
      // that actually settled (fallback re-quotes supersede earlier attempts).
      if (!executedQuoteByDeposit.has(quote.depositIntentId)) executedQuoteByDeposit.set(quote.depositIntentId, quote);
    }
    const executedQuotes = [...executedQuoteByDeposit.values()];
    const totalFee = executedQuotes.reduce((sum, quote) => sum + Number(quote.estimatedFee), 0);
    const totalOutput = executedQuotes.reduce((sum, quote) => sum + Number(quote.estimatedOutput), 0);

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
      providerBreakdown: providerBreaks,
      fallbackQuoteCount: fallbackQuotes,
      // Cost-efficiency KPIs (base units of the settlement token; divide by
      // the token's decimals client-side to render as a human amount).
      averageFeePerSettledDeposit: executedQuotes.length ? totalFee / executedQuotes.length : 0,
      averageOutputPerSettledDeposit: executedQuotes.length ? totalOutput / executedQuotes.length : 0,
    };
  }
}
