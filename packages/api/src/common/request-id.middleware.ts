import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context';

export function RequestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  // Makes ip/userAgent available to AuditService without threading them
  // through every service call site (PRD §Security).
  runWithRequestContext(
    { requestId, ip: req.ip, userAgent: req.headers['user-agent'] },
    next,
  );
}