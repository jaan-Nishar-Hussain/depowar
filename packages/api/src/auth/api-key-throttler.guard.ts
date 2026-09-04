import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ClientContext } from './decorators';

/**
 * Rate-limits per authenticated identity instead of per IP (Next-Gen Routing
 * PRD §Security: "Protect /quote, /execute endpoints with rate limiting per
 * API key"). `ApiKeyGuard` runs before this guard (registered first in
 * `AppModule`) and attaches `request.client`, so by the time this tracker
 * runs the API key's client id is available. Falls back to IP for public
 * routes (health check, metrics) and for requests that somehow reach this
 * guard unauthenticated.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const client = (req as { client?: ClientContext }).client;
    if (client?.id) return `client:${client.id}`;
    return super.getTracker(req as never);
  }
}
