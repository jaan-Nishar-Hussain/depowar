import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` with `context` available to every downstream service via
 * `getRequestContext()`, without threading `ip`/`userAgent` through every
 * service constructor and call site. Set up once in `RequestIdMiddleware`;
 * consumed by `AuditService` (Next-Gen Routing PRD §Security: "Include IP,
 * user agent" on audit records).
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
