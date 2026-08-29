import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUE_WEBHOOK_DISPATCH } from './queue.service';
import { generateId } from '@paymesh/db';

export type LifecycleEventType =
  | 'quote.ready'
  | 'tx.submitted'
  | 'tx.confirmed'
  | 'deposit.settled'
  | 'deposit.failed';

/**
 * Writes a lifecycle event row and enqueues delivery. The worker's
 * webhook-dispatch consumer reads the row, finds matching subscriptions for
 * the client, and POSTs an HMAC-signed payload.
 */
@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async emit(
    clientId: string,
    type: LifecycleEventType,
    payload: Record<string, unknown>,
    depositIntentId?: string,
  ): Promise<string> {
    const event = await this.prisma.event.create({
      data: {
        id: generateId('evt'),
        clientId,
        depositIntentId,
        type,
        payload: payload as object,
      },
    });
    await this.queue.enqueue(QUEUE_WEBHOOK_DISPATCH, 'dispatch', { eventId: event.id });
    return event.id;
  }
}