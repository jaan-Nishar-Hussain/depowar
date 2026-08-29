export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  BRIDGE_FAILED: 'BRIDGE_FAILED',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  SCREENING_BLOCKED: 'SCREENING_BLOCKED',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  DEPOSIT_NOT_FOUND: 'DEPOSIT_NOT_FOUND',
  QUOTE_NOT_FOUND: 'QUOTE_NOT_FOUND',
  HOP_NOT_FOUND: 'HOP_NOT_FOUND',
  TX_ALREADY_SUBMITTED: 'TX_ALREADY_SUBMITTED',
  SIGNER_NOT_CONFIGURED: 'SIGNER_NOT_CONFIGURED',
  UNSUPPORTED_CHAIN: 'UNSUPPORTED_CHAIN',
  DATABASE_CONFLICT: 'DATABASE_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Domain error with a typed code and a `userMessage` that is safe to render
 * directly in a UI. Every public endpoint returns errors in this shape.
 */
export class PayMeshError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    public readonly userMessage: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PayMeshError';
  }
}