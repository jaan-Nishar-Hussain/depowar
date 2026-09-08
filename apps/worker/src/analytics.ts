import { WorkerContext } from './context';

/**
 * Daily KPI rollup (PRD §Monitoring: "aggregated KPIs (latency, success rate,
 * cost)"). Computes per-project deposit/settlement counts and settled volume
 * for the current calendar day and upserts them into `AnalyticsDaily`. Runs on
 * a schedule; upserting makes re-runs idempotent.
 */
export async function rollupAnalyticsDaily(ctx: WorkerContext): Promise<void> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const projects = await ctx.prisma.project.findMany({ select: { id: true, organizationId: true } });
  for (const project of projects) {
    const statuses = await ctx.prisma.depositIntent.groupBy({
      by: ['status'],
      where: { projectId: project.id, createdAt: { gte: dayStart } },
      _count: true,
    });
    const count = (status: string): number => statuses.find((s) => s.status === status)?._count ?? 0;
    const deposits = statuses.reduce((sum, s) => sum + s._count, 0);
    const settled = count('SETTLED');
    const failed = count('FAILED');

    const volume = await ctx.prisma.quote.aggregate({
      where: {
        depositIntent: { projectId: project.id },
        createdAt: { gte: dayStart },
        transactions: { some: { txHash: { not: null } } },
      },
      _sum: { estimatedOutput: true },
    });

    await ctx.prisma.analyticsDaily.upsert({
      where: {
        projectId_day: { projectId: project.id, day: dayStart },
      },
      create: {
        organizationId: project.organizationId,
        projectId: project.id,
        day: dayStart,
        deposits,
        settled,
        failed,
        volume: (volume._sum.estimatedOutput ?? 0n).toString(),
        settledVolume: (volume._sum.estimatedOutput ?? 0n).toString(),
      },
      update: {
        deposits,
        settled,
        failed,
        volume: (volume._sum.estimatedOutput ?? 0n).toString(),
        settledVolume: (volume._sum.estimatedOutput ?? 0n).toString(),
      },
    });
  }
}