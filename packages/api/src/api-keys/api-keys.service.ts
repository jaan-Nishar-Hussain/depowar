import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { generateId, hashApiKey } from '@paymesh/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateApiKeyDto } from './dto';

const DEFAULT_SCOPES = ['deposits', 'quote', 'webhooks', 'recipients'];

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  async list(clientId: string) {
    return this.prisma.apiKey.findMany({ where: { clientId }, select: { id: true, scopes: true, enabled: true, lastUsedAt: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(clientId: string, dto: CreateApiKeyDto) {
    const key = `dw_live_${randomBytes(24).toString('hex')}`;
    const record = await this.prisma.apiKey.create({ data: { id: generateId('key'), clientId, keyHash: hashApiKey(key), scopes: dto.scopes ?? DEFAULT_SCOPES } });
    await this.audit.record({ clientId, actor: 'api', action: 'api-key.created', entityType: 'ApiKey', entityId: record.id, details: { scopes: record.scopes } });
    return { id: record.id, key, scopes: record.scopes, createdAt: record.createdAt, warning: 'Store this key now. It will not be shown again.' };
  }

  async revoke(clientId: string, id: string) {
    const result = await this.prisma.apiKey.updateMany({ where: { id, clientId, enabled: true }, data: { enabled: false } });
    if (result.count) await this.audit.record({ clientId, actor: 'api', action: 'api-key.revoked', entityType: 'ApiKey', entityId: id });
    return { revoked: result.count === 1 };
  }
}
