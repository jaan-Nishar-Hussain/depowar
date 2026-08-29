import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { AppEnv } from '@paymesh/config';
import { ENV } from '../common/tokens';

export const QUEUE_TX_MONITOR = 'tx-monitor';
export const QUEUE_WEBHOOK_DISPATCH = 'webhook-dispatch';
export const QUEUE_QUOTE_EXPIRY = 'quote-expiry';
export const QUEUE_FALLBACK_ROUTE = 'fallback-route';

/**
 * BullMQ queue factory. One shared Redis connection per queue is created
 * lazily; jobs are consumed by the @paymesh/worker process.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  private connection(): ConnectionOptions {
    return { url: this.env.REDIS_URL, maxRetriesPerRequest: null };
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(name: string, jobName: string, data: unknown, opts?: JobsOptions): Promise<void> {
    await this.getQueue(name).add(jobName, data, opts);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}