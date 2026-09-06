import { WorkerContext } from './context';

/**
 * Daily KPI rollup (PRD §Monitoring: "aggregated KPIs (latency, success rate,
 * cost)"). Computes per-client deposit/settlement counts and settled volume
 * for the current calendar day and upserts them into `AnalyticsDaily` — the
 * model existed but was never written, so the analytics endpoint had nothing
 * to aggregate over time. Runs on a schedule; upserting makes re-runs
 * idempotent.
 */
export async function rollupAnalyticsDaily(ctx: WorkerContext): Promise<void> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const clients = await ctx.prisma.client.findMany({ select: { id: true } });
  for (const client of clients) {
    const project = await ctx.prisma.project.findFirst({
      where: { OR: [{ clientId: client.id }, { liveClientId: client.id }] },
      select: { id: true, organizationId: true },
    });
    // AnalyticsDaily requires an owning project; clients not created through
    // a project (e.g. raw test fixtures) are skipped rather than mis-recorded.
    if (!project) continue;

    const statuses = await ctx.prisma.depositIntent.groupBy({
      by: ['status'],
      where: { clientId: client.id, createdAt: { gte: dayStart } },
      _count: true,
    });
    const count = (status: string): number => statuses.find((s) => s.status === status)?._count ?? 0;
    const deposits = statuses.reduce((sum, s) => sum + s._count, 0);
    const settled = count('SETTLED');
    const failed = count('FAILED');

    const volume = await ctx.prisma.quote.aggregate({
      where: {
        depositIntent: { clientId: client.id },
        createdAt: { gte: dayStart },
        transactions: { some: { txHash: { not: null } } },
      },
      _sum: { estimatedOutput: true, estimatedFee: true },
    });
    const settledVolume = volume._sum.estimatedOutput ?? 0n;

    await ctx.prisma.analyticsDaily.upsert({
      where: {
        projectId_clientId_day: { projectId: project.id, clientId: client.id, day: dayStart },
      },
      create: {
        projectId: project.id,
        organizationId: project.organizationId,
        clientId: client.id,
        day: dayStart,
        deposits,
        settled,
        failed,
        volume: (volume._sum.estimatedOutput ?? 0n).toString(),
        settledVolume: settledVolume.toString(),
      },
      update: {
        deposits,
        settled,
        failed,
        volume: (volume._sum.estimatedOutput ?? 0n).toString(),
        settledVolume: settledVolume.toString(),
      },
    });
  }
}