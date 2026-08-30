import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@paymesh/db';
import { loadEnv } from '@paymesh/config';
import { connection, QUEUE_TX_MONITOR, QUEUE_WEBHOOK_DISPATCH, QUEUE_QUOTE_EXPIRY, QUEUE_FALLBACK_ROUTE } from './queues';
import { createWorkerContext, type WorkerContext } from './context';
import { processTxMonitor, processFallback } from './monitor';
import { processWebhookDispatch } from './webhook';
import { processQuoteExpiry } from './expiry';

// Load the repo-root .env so `cp .env.example .env` works from the monorepo root.
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

export function startWorkers(ctx: WorkerContext): Worker[] {
  const opts = { connection: connection(ctx.env), concurrency: 4 };
  const workers = [
    // A single monitor consumer prevents two jobs from submitting competing
    // transactions with the same relayer account nonce.
    new Worker(QUEUE_TX_MONITOR, (job) => processTxMonitor(job, ctx), { ...opts, concurrency: 1 }),
    new Worker(QUEUE_WEBHOOK_DISPATCH, (job) => processWebhookDispatch(job, ctx), {
      connection: connection(ctx.env),
      concurrency: 4,
      limiter: { max: 20, duration: 1000 },
    }),
    new Worker(QUEUE_QUOTE_EXPIRY, (job) => processQuoteExpiry(job, ctx), {
      connection: connection(ctx.env),
      concurrency: 2,
    }),
    new Worker(QUEUE_FALLBACK_ROUTE, (job) => processFallback(job, ctx), {
      connection: connection(ctx.env),
      concurrency: 2,
    }),
  ];
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`[worker] job failed queue=${worker.name} name=${job?.name} err=${err.message}`);
    });
  }
  return workers;
}

async function recoverPendingSettlements(ctx: WorkerContext): Promise<void> {
  const queue = new Queue(QUEUE_TX_MONITOR, { connection: connection(ctx.env) });
  try {
    const pending = await ctx.prisma.transaction.findMany({
      where: { status: 'SETTLEMENT_PENDING', txHash: { not: null } },
      select: { id: true },
    });
    for (const transaction of pending) {
      await queue.add('monitor-recovery', { transactionId: transaction.id }, {
        attempts: 120,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    }
    if (pending.length > 0) {
      console.log(`[worker] recovered ${pending.length} pending settlement(s)`);
    }
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const ctx = createWorkerContext(env, prisma);
  const workers = startWorkers(ctx);
  await recoverPendingSettlements(ctx);

  // eslint-disable-next-line no-console
  console.log(`Depowar worker listening on ${workers.length} queues (env=${env.APP_ENV})`);

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('Shutting down worker...');
    await Promise.all(workers.map((w) => w.close()));
    await ctx.eventQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  void main();
}
