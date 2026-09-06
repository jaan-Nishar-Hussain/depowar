import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@paymesh/db';
import { loadEnv } from '@paymesh/config';
import { connection, QUEUE_TX_MONITOR, QUEUE_WEBHOOK_DISPATCH, QUEUE_QUOTE_EXPIRY, QUEUE_FALLBACK_ROUTE, QUEUE_SETTLEMENT } from './queues';
import { createWorkerContext, type WorkerContext } from './context';
import { processTxMonitor, processFallback, failDeposit } from './monitor';
import { processSettlement } from './settlement';
import { processWebhookDispatch } from './webhook';
import { processQuoteExpiry } from './expiry';
import { rollupAnalyticsDaily } from './analytics';

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
    // Dedicated settlement queue (PRD §Execution & Fallback). Attestation
    // waits and destination relaying run here, decoupled from tx-monitoring.
    new Worker(QUEUE_SETTLEMENT, (job) => processSettlement(job, ctx), {
      connection: connection(ctx.env),
      concurrency: 2,
    }),
  ];
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`[worker] job failed queue=${worker.name} name=${job?.name} err=${err.message}`);
      void onJobExhausted(ctx, worker.name, job);
    });
  }
  return workers;
}

/**
 * Compensating actions when a job exhausts its BullMQ attempts (PRD §Fallback
 * Safety: "avoid infinite loops. If all routes fail, funds should not get
 * stuck"). Fallback-route jobs that permanently fail mark the deposit FAILED
 * rather than leaving it stranded; settlement jobs are intentionally left to
 * the periodic recovery sweep (a burn stays attestable, never FAILED).
 */
async function onJobExhausted(
  ctx: WorkerContext,
  queue: string,
  job: { id?: string; name?: string; data?: Record<string, unknown>; attemptsMade?: number; opts?: { attempts?: number } } | null | undefined,
): Promise<void> {
  if (!job || job.opts?.attempts === undefined) return;
  const attempts = job.opts.attempts;
  const made = job.attemptsMade ?? 0;
  if (made + 1 < attempts) return;

  if (queue === QUEUE_FALLBACK_ROUTE) {
    const { depositId, quoteId } = job.data ?? {};
    if (typeof depositId === 'string' && typeof quoteId === 'string') {
      await failDeposit(ctx, depositId, quoteId, 'FALLBACK_FAILED');
    }
  }
}

/**
 * Re-enqueues in-flight settlements whose monitor jobs were lost (worker
 * restart, Redis flush, or exhausted BullMQ attempts). Runs on a schedule so
 * a burn awaiting attestation is never stranded (docs/stuck-fund-recovery.md).
 */
async function recoverPendingSettlements(ctx: WorkerContext): Promise<void> {
  const queue = new Queue(QUEUE_SETTLEMENT, { connection: connection(ctx.env) });
  try {
    const pending = await ctx.prisma.transaction.findMany({
      where: { status: 'SETTLEMENT_PENDING', txHash: { not: null } },
      select: { id: true },
    });
    for (const transaction of pending) {
      await queue.add('settle-recovery', { transactionId: transaction.id }, {
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

function startRecoverySweep(ctx: WorkerContext): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    try {
      await recoverPendingSettlements(ctx);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[worker] recovery sweep failed', error);
    }
  };
  void run();
  return setInterval(run, ctx.env.RECOVERY_SWEEP_INTERVAL_MS);
}

/** Periodic AnalyticsDaily rollup (PRD §Monitoring: aggregated KPIs). */
function startAnalyticsRollup(ctx: WorkerContext): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    try {
      await rollupAnalyticsDaily(ctx);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[worker] analytics rollup failed', error);
    }
  };
  void run();
  return setInterval(run, ctx.env.ANALYTICS_ROLLUP_INTERVAL_MS);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const ctx = createWorkerContext(env, prisma);
  const workers = startWorkers(ctx);
  const sweep = startRecoverySweep(ctx);
  const analytics = startAnalyticsRollup(ctx);

  // eslint-disable-next-line no-console
  console.log(`Depowar worker listening on ${workers.length} queues (env=${env.APP_ENV})`);

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('Shutting down worker...');
    clearInterval(sweep);
    clearInterval(analytics);
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