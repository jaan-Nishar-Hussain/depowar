import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { verifyApiKeyHash } from '@paymesh/db';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, SCOPES_KEY, ClientContext } from './decorators';
import { PayMeshError } from '../common/errors';
import { AuthService } from './auth.service';
import { augmentRequestContext } from '../common/request-context';

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
      // A session is valid when its client belongs to a project the user is a
      // member of, OR (for a fresh account with no project yet) when the client
      // is the owning organization's default sign-up client.
      const validSession = await this.prisma.project.findFirst({
        where: {
          OR: [{ clientId: claims.clientId }, { liveClientId: claims.clientId }],
          organization: { memberships: { some: { userId: claims.sub, status: 'ACTIVE' } } },
        },
        select: { clientId: true },
      });
      if (!validSession) {
        const defaultOrg = await this.prisma.organization.findFirst({
          where: { defaultClientId: claims.clientId, memberships: { some: { userId: claims.sub, status: 'ACTIVE' } } },
          select: { id: true },
        });
        if (!defaultOrg) throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
      }
      (request as Request & { client: ClientContext }).client = { id: claims.clientId, scopes: ['*'] };
      (request as Request & { user: { id: string; email: string } }).user = { id: claims.sub, email: claims.email };
      augmentRequestContext({ clientId: claims.clientId });
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

    const prefix = key.startsWith('dw_live_') ? 'dw_live_' : key.startsWith('dw_test_') ? 'dw_test_' : '';
    let record: Awaited<ReturnType<typeof this.prisma.apiKey.findFirst>> = null;
    if (prefix) {
      // Constant-time hash comparison (PRD §Security). ApiKeysService stores
      // keyPrefix = plaintext.slice(0, 12), so match that exact prefix (not
      // the 8-char token) for the key's environment, then verify each hash.
      const candidates = await this.prisma.apiKey.findMany({
        where: { keyPrefix: key.slice(0, 12), environment: prefix === 'dw_live_' ? 'LIVE' : 'TEST' },
        include: { client: true },
      });
      record = candidates.find((candidate) => verifyApiKeyHash(key, candidate.keyHash)) ?? null;
    }
    if (!record) {
      // Fallback for keys not found by the dw_ prefix path (e.g. legacy or
      // manually-inserted keys): a bounded scan of every enabled key, still
      // verified with the constant-time hash comparison. Kept separate from
      // the prefixed path so the common case stays a single indexed query.
      const candidates = await this.prisma.apiKey.findMany({
        where: { enabled: true },
        include: { client: true },
      });
      record = candidates.find((candidate) => verifyApiKeyHash(key, candidate.keyHash)) ?? null;
    }

    if (!record || !record.enabled || !!record.revokedAt || (record.expiresAt && record.expiresAt <= new Date())) {
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
    augmentRequestContext({ clientId: record.clientId });

    this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
