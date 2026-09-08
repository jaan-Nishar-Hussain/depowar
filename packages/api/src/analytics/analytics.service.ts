import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async timeseries(projectId: string, days = 30): Promise<unknown> {
    const windowDays = Number.isFinite(days) ? Math.min(365, Math.max(1, Math.trunc(days))) : 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const deposits = await this.prisma.depositIntent.findMany({
      where: { projectId, createdAt: { gte: since } },
      select: { id: true, status: true, createdAt: true },
    });
    const settledIds = deposits.filter((d) => d.status === 'SETTLED').map((d) => d.id);
    const quotes = settledIds.length
      ? await this.prisma.quote.findMany({
          where: { depositIntentId: { in: settledIds }, transactions: { some: { txHash: { not: null } } } },
          select: { depositIntentId: true, estimatedOutput: true, createdAt: true },
        })
      : [];
    const outputByDeposit = new Map<string, string>();
    for (const q of quotes) {
      if (!outputByDeposit.has(q.depositIntentId)) outputByDeposit.set(q.depositIntentId, q.estimatedOutput.toString());
    }

    const buckets = new Map<string, { deposits: number; settled: number; failed: number; volume: string; settledVolume: string }>();
    const key = (d: Date): string => d.toISOString().slice(0, 10);
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      buckets.set(key(d), { deposits: 0, settled: 0, failed: 0, volume: '0', settledVolume: '0' });
    }
    for (const deposit of deposits) {
      const k = key(deposit.createdAt);
      const bucket = buckets.get(k);
      if (!bucket) continue;
      bucket.deposits += 1;
      if (deposit.status === 'SETTLED') {
        bucket.settled += 1;
        const out = outputByDeposit.get(deposit.id);
        if (out) {
          bucket.settledVolume = (BigInt(bucket.settledVolume) + BigInt(out)).toString();
        }
      } else if (deposit.status === 'FAILED') {
        bucket.failed += 1;
      }
      bucket.volume = bucket.volume === '0' ? '0' : bucket.volume; // volume tracked at settle time
    }
    return { days: windowDays, series: [...buckets.entries()].map(([day, b]) => ({ day, ...b })) };
  }

  async overview(projectId: string, days = 30): Promise<unknown> {
    const windowDays = Number.isFinite(days) ? Math.min(365, Math.max(1, Math.trunc(days))) : 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const deposits = await this.prisma.depositIntent.findMany({
      where: { projectId, createdAt: { gte: since } },
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
      where: { depositIntent: { projectId } },
      select: { providerId: true, fallbackFromQuoteId: true, createdAt: true, depositIntentId: true, fromChainId: true, fromToken: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const providerBreaks = quotes.reduce<Record<string, number>>((result, quote) => {
      const key = quote.providerId ?? 'unknown';
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
    const fallbackQuotes = quotes.filter((quote) => quote.fallbackFromQuoteId !== null).length;

    // Top source chains/tokens from quote history (Next-Gen PRD §Coverage).
    const topSourceChains = quotes.reduce<Record<number, number>>((acc, q) => {
      if (q.fromChainId) acc[q.fromChainId] = (acc[q.fromChainId] ?? 0) + 1;
      return acc;
    }, {});
    const topTokens = quotes.reduce<Record<string, number>>((acc, q) => {
      if (q.fromToken) acc[q.fromToken] = (acc[q.fromToken] ?? 0) + 1;
      return acc;
    }, {});

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
      topSourceChains,
      topTokens,
      // Cost-efficiency KPIs (base units of the settlement token; divide by
      // the token's decimals client-side to render as a human amount).
      averageFeePerSettledDeposit: executedQuotes.length ? totalFee / executedQuotes.length : 0,
      averageOutputPerSettledDeposit: executedQuotes.length ? totalOutput / executedQuotes.length : 0,
    };
  }
}
