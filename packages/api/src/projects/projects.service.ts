import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';
import { AuthService } from '../auth/auth.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { RecipientsService } from '../recipients/recipients.service';

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService, @Inject(ApiKeysService) private readonly apiKeys: ApiKeysService, @Inject(RecipientsService) private readonly recipients: RecipientsService) {}

  async list(userId: string, projectId: string) {
    if (!projectId) {
      // Fresh account with no project yet: list nothing (or their org's projects).
      const org = await this.prisma.organization.findFirst({ where: { memberships: { some: { userId, status: 'ACTIVE' } } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!org) return [];
      return this.prisma.project.findMany({ where: { organizationId: org.id, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { id: true, name: true, environment: true }, orderBy: { createdAt: 'asc' } });
    }
    const current = await this.prisma.project.findFirst({ where: { id: projectId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { organizationId: true } });
    if (!current) return [];
    return this.prisma.project.findMany({ where: { organizationId: current.organizationId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { id: true, name: true, environment: true }, orderBy: { createdAt: 'asc' } });
  }

  get(projectId: string): Promise<unknown> {
    return this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, environment: true, organizationId: true, createdAt: true, updatedAt: true, _count: { select: { apiKeys: true, recipients: true, depositIntents: true } } },
    });
  }

  async update(projectId: string, name: string) {
    const project = await this.prisma.project.update({ where: { id: projectId }, data: { name: name.trim() }, select: { id: true, name: true, environment: true, createdAt: true, updatedAt: true } }).catch(() => null);
    if (!project) throw new PayMeshError('INTERNAL_ERROR', `Project ${projectId} not found`, 'The project does not exist.', 404);
    return project;
  }

  async create(userId: string, currentProjectId: string | null, name: string, environment: 'TEST' | 'LIVE', receiverAddress: string, destinationChainId: number, destinationToken: 'USDC' | 'USDT', idempotencyKey?: string): Promise<unknown> {
    if (idempotencyKey) {
      const previous = await this.prisma.idempotencyRecord.findUnique({ where: { key_operation: { key: idempotencyKey, operation: 'project.create' } } });
      if (previous && previous.expiresAt > new Date()) throw new PayMeshError('DATABASE_CONFLICT', 'This project creation request was already processed.', 'This request was already processed. The API key was shown only on the first response.', 409);
    }
    // Resolve the owning organization: prefer the current project's org; a fresh
    // account with no project yet falls back to its first active membership.
    const current = currentProjectId
      ? await this.prisma.project.findFirst({ where: { id: currentProjectId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { organizationId: true } })
      : null;
    const fallback = current ? null : await this.prisma.organization.findFirst({ where: { memberships: { some: { userId, status: 'ACTIVE' } } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const organizationId = current?.organizationId ?? fallback?.id;
    if (!organizationId) throw new PayMeshError('FORBIDDEN', 'Organization access denied', 'You do not own this organization.', 403);
    const project = await this.prisma.project.create({ data: { organizationId, name: name.trim(), environment }, select: { id: true, name: true, environment: true, organizationId: true } });
    await this.recipients.create(project.id, { walletAddress: receiverAddress, chainId: destinationChainId, token: destinationToken, settlementType: 'EOA' });
    const apiKey = await this.apiKeys.create(project.id, { scopes: ['deposits', 'quote', 'webhooks', 'recipients'] });
    const response = { project, apiKey };
    if (idempotencyKey) {
      const safeResponse = { project, apiKey: { id: apiKey.id, scopes: apiKey.scopes, warning: apiKey.warning } };
      await this.prisma.idempotencyRecord.create({ data: { key: idempotencyKey, operation: 'project.create', organizationId: project.organizationId, projectId: project.id, response: safeResponse, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }).catch(() => undefined);
    }
    return response;
  }

  async switch(userId: string, email: string, projectId: string, environment: 'TEST' | 'LIVE' = 'TEST') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organization: { memberships: { some: { userId, status: 'ACTIVE' } } } }, select: { organizationId: true, name: true, environment: true } });
    if (!project) throw new PayMeshError('FORBIDDEN', 'Project environment unavailable', 'This project is not available.', 403);
    if (project.environment === environment) {
      return this.auth.sessionForProject(userId, email, project.organizationId, projectId);
    }
    // Switch to the sibling environment (e.g. TEST → LIVE). Create it lazily if
    // it does not exist yet, copying the receiver config.
    const sibling = await this.prisma.project.findFirst({ where: { organizationId: project.organizationId, name: project.name, environment }, select: { id: true } });
    if (sibling) return this.auth.sessionForProject(userId, email, project.organizationId, sibling.id);
    const created = await this.prisma.project.create({ data: { organizationId: project.organizationId, name: project.name, environment }, select: { id: true } });
    const source = await this.prisma.recipient.findFirst({ where: { projectId }, select: { walletAddress: true, preferredChainId: true, preferredToken: true, settlementType: true } });
    if (source?.walletAddress && source.preferredChainId) {
      await this.recipients.create(created.id, { walletAddress: source.walletAddress, chainId: source.preferredChainId, token: (source.preferredToken ?? 'USDC') === 'native' ? 'USDC' : source.preferredToken ?? 'USDC', settlementType: (source.settlementType as 'EOA' | 'CONTRACT') ?? 'EOA' });
    }
    return this.auth.sessionForProject(userId, email, project.organizationId, created.id);
  }
}