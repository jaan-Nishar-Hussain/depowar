import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayMeshError } from '../common/errors';
import type { UpdateProjectDto } from './dto';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get(clientId: string): Promise<unknown> {
    return this.prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { apiKeys: true, recipients: true, depositIntents: true } } },
    });
  }

  async update(clientId: string, dto: UpdateProjectDto): Promise<unknown> {
    const project = await this.prisma.client.update({ where: { id: clientId }, data: { name: dto.name }, select: { id: true, name: true, createdAt: true, updatedAt: true } }).catch(() => null);
    if (!project) throw new PayMeshError('INTERNAL_ERROR', `Project ${clientId} not found`, 'The project does not exist.', 404);
    await this.audit.record({ clientId, actor: 'api', action: 'project.updated', entityType: 'Client', entityId: clientId });
    return project;
  }
}
