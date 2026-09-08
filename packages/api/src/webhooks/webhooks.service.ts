import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateId } from '@paymesh/db';
import type { CreateWebhookDto } from './dto';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(clientId: string, dto: CreateWebhookDto) {
    const secret = dto.secret ?? randomBytes(32).toString('hex');
    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        id: generateId('wh'),
        clientId,
        url: dto.url,
        events: dto.events,
        secret,
      },
    });
    await this.audit.record({
      clientId,
      actor: 'api',
      action: 'webhook.created',
      entityType: 'WebhookSubscription',
      entityId: subscription.id,
    });
    return { id: subscription.id, url: subscription.url, events: subscription.events, secret };
  }

  async list(clientId: string) {
    return this.prisma.webhookSubscription.findMany({ where: { clientId, enabled: true } });
  }

  /** Delivery log for a webhook (PRD §Monitoring). Rows are written by the
   * worker's dispatch job (status, attempts, responseCode, lastError). */
  async deliveries(clientId: string, id: string, limit = 50) {
    const sub = await this.prisma.webhookSubscription.findFirst({ where: { id, clientId } });
    if (!sub) {
      return { items: [] };
    }
    const items = await this.prisma.webhookDelivery.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      include: { subscription: { select: { url: true } } },
    });
    return { items };
  }

  async remove(clientId: string, id: string) {
    const sub = await this.prisma.webhookSubscription.findFirst({ where: { id, clientId } });
    if (!sub) {
      return { deleted: false };
    }
    await this.prisma.webhookSubscription.delete({ where: { id } });
    await this.audit.record({
      clientId,
      actor: 'api',
      action: 'webhook.deleted',
      entityType: 'WebhookSubscription',
      entityId: id,
    });
    return { deleted: true };
  }
}