import type { ChainId } from './chains';
import { getEnv } from './env';

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
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  143: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  324: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
};

const USDT_ADDRESSES: Record<ChainId, string> = {
  1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  43114: '0x9702230A8Ea53601f5cD2dc00fDBC13d4dF4A8c7',
  42161: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  10: '0x94b008aA00579c1307B0EF2c499Ad98a8ce58e58',
  59144: '0xa219439258ca9da29e9cc4ce5596924745e12b93',
  56: '0x55d398326f99059fF775485246999027B3197955',
  324: '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C',
  // Monad's canonical USDT is the bridged "USDT0" (verified on MonadScan).
  143: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
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
  1: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[1], decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[1], decimals: 6 },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  8453: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[8453], decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[8453], decimals: 6 },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  137: [
    { symbol: 'POL', name: 'Polygon', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[137], decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[137], decimals: 6 },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
  ],
  43114: [{ symbol: 'AVAX', name: 'Avalanche', address: null, decimals: 18, native: true }, { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[43114], decimals: 6 }, { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[43114], decimals: 6 }],
  42161: [{ symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true }, { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[42161], decimals: 6 }, { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[42161], decimals: 6 }],
  10: [{ symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true }, { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[10], decimals: 6 }, { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[10], decimals: 6 }],
  59144: [{ symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true }, { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[59144], decimals: 6 }, { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[59144], decimals: 6 }],
  143: [{ symbol: 'MON', name: 'Monad', address: null, decimals: 18, native: true }, { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[143], decimals: 6 }, { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[143], decimals: 6 }],
  56: [
    { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[56], decimals: 18 },
    { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[56], decimals: 18 },
  ],
  324: [
    { symbol: 'ETH', name: 'Ether', address: null, decimals: 18, native: true },
    { symbol: 'USDC', name: 'USD Coin', address: USDC_ADDRESSES[324], decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: USDT_ADDRESSES[324], decimals: 6 },
  ],
};

export function getTokens(chainId: ChainId): TokenInfo[] {
  const tokens = [...(TOKENS[chainId] ?? [])];
  const env = getEnv();
  const usdt = chainId === 11155111
    ? env.PAYMESH_SEPOLIA_USDT_ADDRESS
    : chainId === 84532
      ? env.PAYMESH_BASE_SEPOLIA_USDT_ADDRESS
      : '';
  if (usdt && !tokens.some((token) => token.symbol === 'USDT')) tokens.push({ symbol: 'USDT', name: 'Tether USD', address: usdt, decimals: 6 });
  return tokens;
}

export function getToken(chainId: ChainId, symbol: string): TokenInfo | undefined {
  return getTokens(chainId).find((t) => t.symbol === symbol);
}
