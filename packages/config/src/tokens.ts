import type { ChainId } from './chains';

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string | null; // null => native asset
  decimals: number;
  native?: boolean;
}

export const NATIVE_SYMBOL = 'ETH';

const USDC_ADDRESSES: Record<ChainId, string> = {
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC (official, 6 dec)
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC (official, 6 dec)
  421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC (official, 6 dec)
};

/**
 * Supported asset registry (PRD §8 `Token` entity). On Anvil these addresses
 * are replaced at deploy time by the testkit; the registry keeps well-known
 * testnet addresses for the real-RPC path.
 */
export const TOKENS: Record<ChainId, TokenInfo[]> = {
  31337: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'Mock USDC', address: null, decimals: 6 },
    { symbol: 'WETH', name: 'Mock WETH', address: null, decimals: 18 },
  ],
  11155111: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[11155111], decimals: 6 },
    { symbol: 'WETH', name: 'Mock WETH', address: null, decimals: 18 },
  ],
  84532: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[84532], decimals: 6 },
    { symbol: 'WETH', name: 'Mock WETH', address: null, decimals: 18 },
  ],
  421614: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[421614], decimals: 6 },
    { symbol: 'WETH', name: 'Mock WETH', address: null, decimals: 18 },
  ],
};

export function getTokens(chainId: ChainId): TokenInfo[] {
  return TOKENS[chainId] ?? [];
}

export function getToken(chainId: ChainId, symbol: string): TokenInfo | undefined {
  return getTokens(chainId).find((t) => t.symbol === symbol);
}