import { createHmac } from 'node:crypto';
import { Job } from 'bullmq';
import { WorkerContext } from './context';

interface DispatchJobData {
  eventId: string;
}

/**
 * Delivers a lifecycle event to every enabled subscription of the owning
 * client that opted into the event type. Payloads are HMAC-signed with each
 * subscription's secret. Delivery failures throw so BullMQ retries with
 * backoff up to WEBHOOK_MAX_ATTEMPTS.
 */
export async function processWebhookDispatch(
  job: Job<DispatchJobData>,
  ctx: WorkerContext,
): Promise<void> {
  const { eventId } = job.data;
  const event = await ctx.prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;

  const subscriptions = await ctx.prisma.webhookSubscription.findMany({
    where: { clientId: event.clientId, enabled: true },
  });
  const matching = subscriptions.filter((s) => s.events.includes(event.type));
  if (matching.length === 0) return;

  for (const subscription of matching) {
    const body = {
      id: event.id,
      type: event.type,
      clientId: event.clientId,
      depositIntentId: event.depositIntentId,
      payload: event.payload,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(body);
    const signature = createHmac('sha256', subscription.secret).update(serialized).digest('hex');

    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paymesh-signature': signature,
        'x-paymesh-event': event.type,
      },
      body: serialized,
    });
    if (!response.ok) {
      throw new Error(`webhook delivery to ${subscription.url} failed with ${response.status}`);
    }
  }
}