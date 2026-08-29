export class PayMeshRoutingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly userMessage: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PayMeshRoutingError';
  }
}

export function routeNotFound(details?: Record<string, unknown>): PayMeshRoutingError {
  return new PayMeshRoutingError(
    'ROUTE_NOT_FOUND',
    'No route could be constructed for the requested deposit',
    'No route is available for that combination of chain and asset.',
    details,
  );
}

export function insufficientLiquidity(details?: Record<string, unknown>): PayMeshRoutingError {
  return new PayMeshRoutingError(
    'INSUFFICIENT_LIQUIDITY',
    'A candidate route reported insufficient liquidity',
    'There is not enough liquidity on that route right now. Try a smaller amount.',
    details,
  );
}