export * from './env';
export * from './chains';
export * from './tokens';

/** Default slippage tolerance used when the client doesn't specify one. */
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

/** How long a quote stays valid before it must be re-quoted. */
export const QUOTE_TTL_SECONDS = 60;

/** Minimum confirmations required before a hop is considered settled. */
export const MIN_CONFIRMATIONS = 1;