import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';
import { AuthService } from '../auth/auth.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { RecipientsService } from '../recipients/recipients.service';

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService, @Inject(ApiKeysService) private readonly apiKeys: ApiKeysService, @Inject(RecipientsService) private readonly recipients: RecipientsService) {}

  async list(userId: string, clientId: string) {
    const current = await this.prisma.project.findFirst({
      where: { OR: [{ clientId }, { liveClientId: clientId }] },
      select: { organizationId: true },
    });
    if (!current) return [];
    return this.prisma.project.findMany({ where: { organizationId: current.organizationId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { id: true, name: true, environment: true, clientId: true, liveClientId: true }, orderBy: { createdAt: 'asc' } });
  }

  get(clientId: string): Promise<unknown> { return this.prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, environment: true, createdAt: true, updatedAt: true, _count: { select: { apiKeys: true, recipients: true, depositIntents: true } } } }); }

  async update(clientId: string, name: string) {
    const project = await this.prisma.client.update({ where: { id: clientId }, data: { name: name.trim() }, select: { id: true, name: true, createdAt: true, updatedAt: true } }).catch(() => null);
    if (!project) throw new PayMeshError('INTERNAL_ERROR', `Project ${clientId} not found`, 'The project does not exist.', 404);
    return project;
  }

  async create(userId: string, clientId: string, name: string, environment: string, receiverAddress: string, destinationChainId: number, destinationToken: 'USDC' | 'USDT', idempotencyKey?: string): Promise<unknown> {
    if (idempotencyKey) {
      const previous = await this.prisma.idempotencyRecord.findUnique({ where: { key_operation: { key: idempotencyKey, operation: 'project.create' } } });
      if (previous && previous.expiresAt > new Date()) throw new PayMeshError('DATABASE_CONFLICT', 'This project creation request was already processed.', 'This request was already processed. The API key was shown only on the first response.', 409);
    }
    const current = await this.prisma.project.findFirst({
      where: { OR: [{ clientId }, { liveClientId: clientId }] },
      select: { organizationId: true },
    });
    if (!current) throw new PayMeshError('FORBIDDEN', 'Project access denied', 'The current project is not connected to a workspace.', 403);
    const organization = await this.prisma.organization.findFirst({ where: { id: current.organizationId, memberships: { some: { userId, status: 'ACTIVE' } } }, select: { id: true } });
    if (!organization) throw new PayMeshError('FORBIDDEN', 'Workspace access denied', 'You do not own this workspace.', 403);
    const testClient = await this.prisma.client.create({ data: { name: name.trim(), environment: 'TEST' } });
    const liveClient = await this.prisma.client.create({ data: { name: name.trim(), environment: 'LIVE' } });
    const project = await this.prisma.project.create({ data: { organizationId: current.organizationId, name: name.trim(), environment, clientId: testClient.id, liveClientId: liveClient.id }, select: { id: true, name: true, environment: true, clientId: true, liveClientId: true } });
    await this.recipients.create(testClient.id, { walletAddress: receiverAddress, chainId: destinationChainId, token: destinationToken, settlementType: 'EOA' });
    await this.recipients.create(liveClient.id, { walletAddress: receiverAddress, chainId: destinationChainId, token: destinationToken, settlementType: 'EOA' });
    const apiKey = await this.apiKeys.create(testClient.id, { scopes: ['deposits', 'quote', 'webhooks', 'recipients'] });
    const response = { project, apiKey };
    if (idempotencyKey) {
      const safeResponse = { project, apiKey: { id: apiKey.id, scopes: apiKey.scopes, warning: apiKey.warning } };
      await this.prisma.idempotencyRecord.create({ data: { key: idempotencyKey, operation: 'project.create', organizationId: current.organizationId, projectId: project.id, response: safeResponse, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }).catch(() => undefined);
    }
    return response;
  }

  async switch(userId: string, email: string, projectId: string, environment: 'TEST' | 'LIVE' = 'TEST') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { clientId: true, liveClientId: true } });
    const selectedClientId = environment === 'LIVE' ? project?.liveClientId : project?.clientId;
    if (!selectedClientId) throw new PayMeshError('FORBIDDEN', 'Project environment unavailable', 'This project environment is not available.', 403);
    return this.auth.sessionForClient(userId, email, selectedClientId);
  }
}
