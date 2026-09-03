/**
 * Per-request quote memoization. Composing a route graph queries the same
 * adapter/pair/amount several times while exploring alternative paths; this
 * cache keeps quote fan-out bounded without changing adapter semantics.
 */
export class QuoteCache {
  private readonly entries = new Map<string, Promise<unknown>>();

  has(key: string): boolean {
    return this.entries.has(key);
  }

  peek<T>(key: string): Promise<T> | undefined {
    return this.entries.get(key) as Promise<T> | undefined;
  }

  /**
   * Returns the cached promise for `key`, or stores the promise produced by
   * `factory`. The promise (not the resolved value) is stored so concurrent
   * explorers share one in-flight quote.
   */
  fetch<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) return existing as Promise<T>;
    const promise = factory();
    this.entries.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Canonical cache key for a swap quote. */
export function swapCacheKey(
  adapterId: string,
  chain: number,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): string {
  return `swap:${adapterId}:${chain}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${amountIn.toString()}`;
}

/** Canonical cache key for a bridge quote. */
export function bridgeCacheKey(
  adapterId: string,
  fromChain: number,
  toChain: number,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): string {
  return `bridge:${adapterId}:${fromChain}:${toChain}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${amountIn.toString()}`;
}
