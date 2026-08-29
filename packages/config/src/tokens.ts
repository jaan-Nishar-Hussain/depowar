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
  80002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', // USDC (Circle testnet, 6 dec)
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
  80002: [
    { symbol: 'POL', name: 'Polygon', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[80002], decimals: 6 },
  ],
};

export function getTokens(chainId: ChainId): TokenInfo[] {
  return TOKENS[chainId] ?? [];
}

export function getToken(chainId: ChainId, symbol: string): TokenInfo | undefined {
  return getTokens(chainId).find((t) => t.symbol === symbol);
}
