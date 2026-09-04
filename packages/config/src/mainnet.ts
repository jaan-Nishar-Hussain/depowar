import { getEnv } from './env';

/** Mainnet-only protocol configuration. Empty contract values intentionally
 * disable the corresponding on-chain adapter until they are verified. */
export function mainnetUniswap(chainId: number): { router?: string; quoter?: string } {
  const env = getEnv();
  if (chainId === 1) return { router: env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  if (chainId === 8453) return { router: env.PAYMESH_BASE_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_BASE_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  if (chainId === 137) return { router: env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  // Arbitrum and Optimism share the same SwapRouter(v1)/QuoterV2 addresses as
  // Ethereum/Polygon (verified against developers.uniswap.org). Avalanche and
  // Monad only have SwapRouter02 deployed — a different ABI than this
  // adapter uses — and Linea has no official Uniswap v3 deployment, so none
  // of those three are wired here.
  if (chainId === 42161) return { router: env.PAYMESH_ARBITRUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_ARBITRUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  if (chainId === 10) return { router: env.PAYMESH_OPTIMISM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_OPTIMISM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  return {};
}

export function cctpTokenMessenger(chainId: number): string {
  const env = getEnv();
  if (chainId === 1) return env.CCTP_ETHEREUM_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 8453) return env.CCTP_BASE_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 137) return env.CCTP_POLYGON_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 42161) return env.CCTP_ARBITRUM_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 10) return env.CCTP_OPTIMISM_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 43114) return env.CCTP_AVALANCHE_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 59144) return env.CCTP_LINEA_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 143) return env.CCTP_MONAD_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 11155111) return env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 84532) return env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS;
  return '';
}

export function cctpMessageTransmitter(chainId: number): string {
  const env = getEnv();
  if (chainId === 1) return env.CCTP_ETHEREUM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 8453) return env.CCTP_BASE_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 137) return env.CCTP_POLYGON_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 42161) return env.CCTP_ARBITRUM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 10) return env.CCTP_OPTIMISM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 43114) return env.CCTP_AVALANCHE_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 59144) return env.CCTP_LINEA_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 143) return env.CCTP_MONAD_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 80002) return env.CCTP_POLYGON_AMOY_MESSAGE_TRANSMITTER_ADDRESS;
  return '';
}

/**
 * CCTP domain IDs (verified against developers.circle.com/cctp/references,
 * Sept 2026). Not the same as the chain's EVM chainId.
 */
export function cctpDomain(chainId: number): number {
  const domains: Record<number, number> = {
    1: 0, 8453: 6, 137: 7, 11155111: 0, 84532: 6, 80002: 7,
    43114: 1, // Avalanche
    10: 2, // OP Mainnet
    42161: 3, // Arbitrum
    59144: 11, // Linea
    143: 15, // Monad
  };
  const domain = domains[chainId];
  if (domain === undefined) throw new Error(`No CCTP domain configured for chain ${chainId}`);
  return domain;
}
