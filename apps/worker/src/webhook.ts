import { createHmac } from 'node:crypto';
import { Job } from 'bullmq';
import { generateId } from '@paymesh/db';
import { WorkerContext } from './context';

interface DispatchJobData {
  eventId: string;
}

/**
 * Delivers a lifecycle event to every enabled subscription of the owning
 * client that opted into the event type. Payloads are HMAC-signed with each
 * subscription's secret.
 *
 * Every attempt is recorded in `WebhookDelivery` (PRD §Monitoring: per-route
 * logs + delivery KPIs). Delivery failures throw so BullMQ retries with
 * backoff up to WEBHOOK_MAX_ATTEMPTS; the row reflects the final state.
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
    include: { deliveries: { where: { eventId }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const matching = subscriptions.filter((s) => s.events.includes(event.type));
  if (matching.length === 0) return;

  const failures: string[] = [];
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

    // Reuse the delivery row across BullMQ retries so one event+subscription
    // maps to one row whose attempt counter reflects the retries.
    const existing = subscription.deliveries[0];
    const delivery = existing
      ? await ctx.prisma.webhookDelivery.update({
          where: { id: existing.id },
          data: { status: 'PENDING', nextAttemptAt: null, lastError: null },
        })
      : await ctx.prisma.webhookDelivery.create({
          data: {
            id: generateId('wd'),
            subscriptionId: subscription.id,
            eventId: event.id,
            status: 'PENDING',
          },
        });

    try {
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
      await ctx.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', responseCode: response.status, deliveredAt: new Date() },
      });
    } catch (error) {
      const message = (error as Error).message ?? 'delivery failed';
      await ctx.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message },
      });
      failures.push(message);
    }
  }

  // Fail the job so BullMQ retries (with backoff up to WEBHOOK_MAX_ATTEMPTS)
  // any subscription that has not been delivered yet.
  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}