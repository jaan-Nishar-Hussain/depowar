import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { generateId, hashApiKey } from '@paymesh/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayMeshError } from '../common/errors';
import type { CreateApiKeyDto } from './dto';

const DEFAULT_SCOPES = ['deposits', 'quote', 'webhooks', 'recipients'];

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  async list(clientId: string) {
    return this.prisma.apiKey.findMany({ where: { clientId }, select: { id: true, keyPrefix: true, name: true, scopes: true, enabled: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(clientId: string, dto: CreateApiKeyDto) {
    // API keys are scoped to a project (PRD §API): the client must belong to
    // a project's TEST or LIVE client before keys can be minted. This forces
    // the intended onboarding flow (create project → generate API key).
    const project = await this.prisma.project.findFirst({
      where: { OR: [{ clientId }, { liveClientId: clientId }] },
      select: { id: true },
    });
    if (!project) {
      throw new PayMeshError(
        'PROJECT_REQUIRED',
        'Create a project before creating API keys',
        'Create a project before creating API keys.',
        400,
      );
    }
    // One active key per project (PRD §API): a new key can only be minted after
    // the current one is revoked, so key rotation is an explicit revoke→create.
    const active = await this.prisma.apiKey.findFirst({
      where: {
        clientId,
        enabled: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (active) {
      throw new PayMeshError(
        'ACTIVE_KEY_EXISTS',
        'Revoke the current API key before creating a new one',
        'Revoke the current API key before creating a new one.',
        409,
      );
    }
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { environment: true } });
    const prefix = client.environment === 'LIVE' ? 'dw_live_' : 'dw_test_';
    const key = `${prefix}${randomBytes(24).toString('hex')}`;
    const record = await this.prisma.apiKey.create({ data: { id: generateId('key'), clientId, keyPrefix: key.slice(0, 12), keyHash: hashApiKey(key), environment: client.environment, scopes: dto.scopes ?? DEFAULT_SCOPES } });
    await this.audit.record({ clientId, actor: 'api', action: 'api-key.created', entityType: 'ApiKey', entityId: record.id, details: { scopes: record.scopes } });
    return { id: record.id, key, scopes: record.scopes, createdAt: record.createdAt, warning: 'Store this key now. It will not be shown again.' };
  }

  async revoke(clientId: string, id: string) {
    const result = await this.prisma.apiKey.updateMany({ where: { id, clientId, enabled: true }, data: { enabled: false, revokedAt: new Date() } });
    if (result.count) await this.audit.record({ clientId, actor: 'api', action: 'api-key.revoked', entityType: 'ApiKey', entityId: id });
    return { revoked: result.count === 1 };
  }
}
