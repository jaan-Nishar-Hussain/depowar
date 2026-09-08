import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** Tenant resolved by the API-key guard, for scoped metrics labels. */
  projectId?: string;
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

/**
 * Enriches the in-flight request context (the AsyncLocalStorage store is the
 * same object reference for the whole request). The API-key guard calls this
 * once the tenant is resolved so downstream metric labels can carry the
 * `clientId` without threading it through every call site.
 */
export function augmentRequestContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}
