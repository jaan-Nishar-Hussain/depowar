import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export function RequestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}