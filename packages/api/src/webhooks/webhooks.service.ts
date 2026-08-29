import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateId } from '@paymesh/db';
import type { CreateWebhookDto } from './dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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