import { PrismaClient } from '@paymesh/db';
import { Queue } from 'bullmq';
import { AppEnv } from '@paymesh/config';
import { createEventQueue, QUEUE_FALLBACK_ROUTE, QUEUE_TX_MONITOR } from './queues';
import type { LifecycleEventType } from './types';

export interface WorkerContext {
  env: AppEnv;
  prisma: PrismaClient;
  eventQueue: Queue;
}

export async function emitEvent(
  ctx: WorkerContext,
  input: {
    clientId: string;
    type: LifecycleEventType;
    payload: Record<string, unknown>;
    depositIntentId?: string;
  },
): Promise<string> {
  const event = await ctx.prisma.event.create({
    data: {
      clientId: input.clientId,
      depositIntentId: input.depositIntentId,
      type: input.type,
      payload: input.payload as object,
    },
  });
  await ctx.eventQueue.add('dispatch', { eventId: event.id });
  return event.id;
}

export async function enqueueFallback(
  ctx: WorkerContext,
  data: { depositId: string; quoteId: string; failedAdapterId?: string | null },
): Promise<void> {
  const queue = new Queue(QUEUE_FALLBACK_ROUTE, { connection: { url: ctx.env.REDIS_URL, maxRetriesPerRequest: null } });
  try {
    await queue.add('fallback', data);
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

export function createWorkerContext(env: AppEnv, prisma: PrismaClient): WorkerContext {
  return { env, prisma, eventQueue: createEventQueue(env) };
}
