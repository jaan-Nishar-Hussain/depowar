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

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers['x-api-key'];

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

    if (!record || !record.enabled) {
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