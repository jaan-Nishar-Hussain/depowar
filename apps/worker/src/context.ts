import { PrismaClient } from '@paymesh/db';
import { Queue } from 'bullmq';
import { AppEnv } from '@paymesh/config';
import { createInMemoryRoutingMetrics, type RoutingMetricsSink } from '@paymesh/routing-engine';
import { createEventQueue, QUEUE_FALLBACK_ROUTE, QUEUE_SETTLEMENT, QUEUE_TX_MONITOR } from './queues';
import type { LifecycleEventType } from './types';

export interface WorkerContext {
  env: AppEnv;
  prisma: PrismaClient;
  eventQueue: Queue;
  /** Process-wide routing KPIs shared with the queue consumers (PRD §Monitoring). */
  routingMetrics: RoutingMetricsSink;
}

export async function emitEvent(
  ctx: WorkerContext,
  input: {
    projectId: string;
    type: LifecycleEventType;
    payload: Record<string, unknown>;
    depositIntentId?: string;
  },
): Promise<string> {
  const event = await ctx.prisma.event.create({
    data: {
      projectId: input.projectId,
      depositIntentId: input.depositIntentId,
      type: input.type,
      payload: input.payload as object,
    },
  });
  await ctx.eventQueue.add('dispatch', { eventId: event.id }, {
    attempts: ctx.env.WEBHOOK_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  });
  return event.id;
}

export async function enqueueFallback(
  ctx: WorkerContext,
  data: { depositId: string; quoteId: string; failedAdapterId?: string | null; attempt?: number },
): Promise<void> {
  const queue = new Queue(QUEUE_FALLBACK_ROUTE, { connection: { url: ctx.env.REDIS_URL, maxRetriesPerRequest: null } });
  try {
    await queue.add('fallback', data, {
      // Transient provider/DB failures retry; the worker's failed-handler
      // marks the deposit FAILED once attempts are exhausted (PRD §Fallback
      // Safety: no infinite loops).
      attempts: ctx.env.FALLBACK_QUEUE_ATTEMPTS,
      backoff: { type: 'fixed', delay: 15_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    });
  } finally {
    await queue.close();
  }
}

/** Enqueues a hop for on-chain monitoring (used by the API via the same queue). */
export async function enqueueMonitor(
  ctx: WorkerContext,
  transactionId: string,
): Promise<void> {
  const queue = new Queue(QUEUE_TX_MONITOR, { connection: { url: ctx.env.REDIS_URL, maxRetriesPerRequest: null } });
  try {
    await queue.add('monitor', { transactionId }, {
      // Circle attestations can take several minutes on testnet. Keep the
      // monitor alive for roughly one hour instead of exhausting retries
      // while the source burn is still valid and awaiting attestation.
      attempts: 120,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } finally {
    await queue.close();
  }
}

/**
 * Enqueues destination settlement for a confirmed terminal hop. Settlement is
 * decoupled from the single-concurrency tx-monitor so a long CCTP attestation
 * wait cannot stall monitoring of other deposits.
 */
export async function enqueueSettlement(
  ctx: WorkerContext,
  transactionId: string,
): Promise<void> {
  const queue = new Queue(QUEUE_SETTLEMENT, { connection: { url: ctx.env.REDIS_URL, maxRetriesPerRequest: null } });
  try {
    await queue.add('settle', { transactionId }, {
      attempts: 120,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } finally {
    await queue.close();
  }
}

export function createWorkerContext(env: AppEnv, prisma: PrismaClient): WorkerContext {
  return { env, prisma, eventQueue: createEventQueue(env), routingMetrics: createInMemoryRoutingMetrics() };
}
