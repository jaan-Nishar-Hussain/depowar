import { getEnv } from './env';

export type ChainId = number;

export interface ChainInfo {
  id: ChainId;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  testnet: boolean;
}

/**
 * Supported network registry (PRD §8 `Chain` entity). RPC URLs resolve to the
 * local Anvil instance by default; real testnet RPCs are used when the
 * corresponding env var is set. Resolution is lazy so tests can override env.
 */
export function listChains(): ChainInfo[] {
  const env = getEnv();
  return [
    {
      id: 31337,
      name: 'Anvil Local',
      rpcUrl: env.ANVIL_RPC_URL,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: true,
    },
    {
      id: 31338,
      name: 'Anvil Local B',
      rpcUrl: env.ANVIL_B_RPC_URL || 'http://127.0.0.1:8546',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: true,
    },
    {
      id: 11155111,
      name: 'Ethereum Sepolia',
      rpcUrl: env.INFURA_SEPOLIA_RPC || env.ALCHEMY_SEPOLIA_RPC || env.ANVIL_RPC_URL,
      explorerUrl: 'https://sepolia.etherscan.io',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: true,
    },
    {
      id: 84532,
      name: 'Base Sepolia',
      rpcUrl: env.ALCHEMY_BASE_SEPOLIA_RPC || env.BASE_SEPOLIA_RPC || env.ANVIL_RPC_URL,
      explorerUrl: 'https://sepolia.basescan.org',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: true,
    },
    {
      id: 80002,
      name: 'Polygon Amoy',
      rpcUrl: env.POLYGON_AMOY_RPC || env.ANVIL_RPC_URL,
      explorerUrl: 'https://amoy.polygonscan.com',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      testnet: true,
    },
    {
      id: 1,
      name: 'Ethereum Mainnet',
      rpcUrl: env.ETHEREUM_MAINNET_RPC,
      explorerUrl: 'https://etherscan.io',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: false,
    },
    {
      id: 8453,
      name: 'Base',
      rpcUrl: env.BASE_MAINNET_RPC,
      explorerUrl: 'https://basescan.org',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: false,
    },
    {
      id: 137,
      name: 'Polygon PoS',
      rpcUrl: env.POLYGON_MAINNET_RPC,
      explorerUrl: 'https://polygonscan.com',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      testnet: false,
    },
  ];
}

export function getChain(id: ChainId): ChainInfo {
  const chain = listChains().find((c) => c.id === id);
  if (!chain) throw new Error(`Unsupported chain id: ${id}`);
  return chain;
}
