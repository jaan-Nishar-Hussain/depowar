import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayMeshError } from '../common/errors';

@Injectable()
export class WorkspacesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.organization.findMany({ where: { memberships: { some: { userId, status: 'ACTIVE' } } }, include: { projects: { select: { id: true, name: true, clientId: true, liveClientId: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async create(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: name.trim(), ownerId: userId } });
      await tx.membership.create({ data: { userId, organizationId: organization.id, role: 'OWNER' } });
      const testClient = await tx.client.create({ data: { name: name.trim(), environment: 'TEST' } });
      const liveClient = await tx.client.create({ data: { name: name.trim(), environment: 'LIVE' } });
      const project = await tx.project.create({ data: { organizationId: organization.id, name: 'Default project', clientId: testClient.id, liveClientId: liveClient.id } });
      return { ...organization, projects: [project], clientId: testClient.id };
    });
  }

  async switch(userId: string, organizationId: string) {
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, memberships: { some: { userId, status: 'ACTIVE' } } }, include: { projects: { select: { clientId: true } } } });
    const clientId = organization?.projects[0]?.clientId;
    if (!organization || !clientId) throw new PayMeshError('FORBIDDEN', 'Workspace access denied', 'You do not belong to this workspace.', 403);
    return { organizationId, clientId };
  }
}
