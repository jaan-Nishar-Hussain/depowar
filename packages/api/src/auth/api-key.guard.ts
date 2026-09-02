import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { hashApiKey } from '@paymesh/db';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, SCOPES_KEY, ClientContext } from './decorators';
import { PayMeshError } from '../common/errors';
import { AuthService } from './auth.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers['x-api-key'];
    const authorization = request.headers.authorization;

    if ((!key || typeof key !== 'string') && authorization?.startsWith('Bearer ')) {
      const claims = this.auth.verify(authorization.slice(7));
      const validSession = await this.prisma.project.findFirst({
        where: {
          OR: [{ clientId: claims.clientId }, { liveClientId: claims.clientId }],
          organization: { memberships: { some: { userId: claims.sub, status: 'ACTIVE' } } },
        },
        select: { clientId: true },
      });
      if (!validSession) throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
      (request as Request & { client: ClientContext }).client = { id: claims.clientId, scopes: ['*'] };
      (request as Request & { user: { id: string; email: string } }).user = { id: claims.sub, email: claims.email };
      return true;
    }

    if (!key || typeof key !== 'string') {
      throw new PayMeshError(
        'UNAUTHENTICATED',
        'Missing API key',
        'Missing API key. Provide it in the X-API-Key header.',
        401,
      );
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
      include: { client: true },
    });

    const expectedPrefix = record?.environment === 'LIVE' ? 'dw_live_' : 'dw_test_';
    if (!record || !key.startsWith(expectedPrefix) || !record.enabled || !!record.revokedAt || (record.expiresAt && record.expiresAt <= new Date())) {
      throw new UnauthorizedException('Invalid API key');
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScopes?.length) {
      const hasScope = requiredScopes.some(
        (s) => record.scopes.includes('*') || record.scopes.includes(s),
      );
      if (!hasScope) {
        throw new PayMeshError(
          'FORBIDDEN',
          'Insufficient API key scope',
          'Your API key cannot perform this action.',
          403,
        );
      }
    }

    const client: ClientContext = { id: record.clientId, scopes: record.scopes };
    (request as Request & { client: ClientContext }).client = client;

    this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
