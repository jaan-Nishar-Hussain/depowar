import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestContext } from '../common/request-context';

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
    /** Overrides the ambient request context; mainly useful in tests. */
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    // Falls back to the current request's ip/user-agent (Next-Gen Routing PRD
    // §Security) so call sites don't each need to thread request data through.
    const ambient = getRequestContext();
    return this.prisma.auditLog
      .create({
        data: {
          clientId: input.clientId,
          actor: input.actor,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          details: input.details as object,
          ip: input.ip ?? ambient?.ip,
          userAgent: input.userAgent ?? ambient?.userAgent,
        },
      })
      .then(() => undefined);
  }
}