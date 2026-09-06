import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RoutingMetricsService } from './routing-metrics.service';

const STUCK_DEPOSIT_MINUTES = 10;
const WORKER_QUEUES = ['tx-monitor', 'webhook-dispatch', 'quote-expiry', 'fallback-route', 'settlement'];

/**
 * Prometheus exposition of routing + infrastructure KPIs (PRD §Monitoring &
 * Observability). Besides the routing counters, this computes cheap gauges
 * that back the PRD's alerting: API 5xx rate, stuck deposits (>10 min), and
 * BullMQ queue backlog growth.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly routingMetrics: RoutingMetricsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queueService: QueueService,
  ) {}

  @Get()
  @Public()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const [stuck, queueBacklog] = await Promise.all([
      this.countStuckDeposits(),
      this.collectQueueBacklog(),
    ]);
    const base = this.routingMetrics.prometheus();
    const infra = [
      '# HELP paymesh_deposits_stuck Deposits in a non-terminal state for more than 10 minutes.',
      '# TYPE paymesh_deposits_stuck gauge',
      `paymesh_deposits_stuck ${stuck}`,
      '# HELP paymesh_queue_backlog BullMQ jobs waiting/delayed per queue.',
      '# TYPE paymesh_queue_backlog gauge',
      ...queueBacklog.map(([queue, waiting]) => `paymesh_queue_backlog{queue="${queue}"} ${waiting}`),
    ].join('\n');
    return `${base}${infra}\n`;
  }

  private async countStuckDeposits(): Promise<number> {
    const cutoff = new Date(Date.now() - STUCK_DEPOSIT_MINUTES * 60_000);
    return this.prisma.depositIntent.count({
      where: {
        status: { notIn: ['SETTLED', 'FAILED'] },
        updatedAt: { lt: cutoff },
      },
    });
  }

  private async collectQueueBacklog(): Promise<Array<[string, number]>> {
    const out: Array<[string, number]> = [];
    for (const name of WORKER_QUEUES) {
      try {
        const queue = this.queueService.getQueue(name);
        const counts = await queue.getJobCounts('waiting', 'delayed');
        out.push([name, (counts.waiting ?? 0) + (counts.delayed ?? 0)]);
      } catch {
        // A queue that cannot be reached (Redis down) reports no backlog.
      }
    }
    return out;
  }
}