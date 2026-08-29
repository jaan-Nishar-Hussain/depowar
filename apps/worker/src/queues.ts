import { Queue, type ConnectionOptions } from 'bullmq';
import { AppEnv } from '@paymesh/config';

export const QUEUE_TX_MONITOR = 'tx-monitor';
export const QUEUE_WEBHOOK_DISPATCH = 'webhook-dispatch';
export const QUEUE_QUOTE_EXPIRY = 'quote-expiry';
export const QUEUE_FALLBACK_ROUTE = 'fallback-route';

export function connection(env: AppEnv): ConnectionOptions {
  return { url: env.REDIS_URL, maxRetriesPerRequest: null };
}

/** Queue used by the worker itself to enqueue webhook delivery after events. */
export function createEventQueue(env: AppEnv): Queue {
  return new Queue(QUEUE_WEBHOOK_DISPATCH, { connection: connection(env) });
}