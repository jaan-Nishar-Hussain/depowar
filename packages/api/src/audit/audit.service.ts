import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  record(input: {
    clientId?: string;
    actor?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    return this.prisma.auditLog
      .create({
        data: {
          clientId: input.clientId,
          actor: input.actor,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          details: input.details as object,
        },
      })
      .then(() => undefined);
  }
}