import { getEnv } from './env';

/** Mainnet-only protocol configuration. Empty contract values intentionally
 * disable the corresponding on-chain adapter until they are verified. */
export function mainnetUniswap(chainId: number): { router?: string; quoter?: string } {
  const env = getEnv();
  if (chainId === 1) return { router: env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  if (chainId === 8453) return { router: env.PAYMESH_BASE_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_BASE_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  if (chainId === 137) return { router: env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_ROUTER_ADDRESS, quoter: env.PAYMESH_POLYGON_MAINNET_UNISWAP_V3_QUOTER_ADDRESS };
  return {};
}

export function cctpTokenMessenger(chainId: number): string {
  const env = getEnv();
  if (chainId === 1) return env.CCTP_ETHEREUM_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 8453) return env.CCTP_BASE_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 137) return env.CCTP_POLYGON_MAINNET_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 11155111) return env.CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS;
  if (chainId === 84532) return env.CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS;
  return '';
}

export function cctpMessageTransmitter(chainId: number): string {
  const env = getEnv();
  if (chainId === 1) return env.CCTP_ETHEREUM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 8453) return env.CCTP_BASE_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 137) return env.CCTP_POLYGON_MAINNET_MESSAGE_TRANSMITTER_ADDRESS;
  if (chainId === 80002) return env.CCTP_POLYGON_AMOY_MESSAGE_TRANSMITTER_ADDRESS;
  return '';
}

export function cctpDomain(chainId: number): number {
  const domains: Record<number, number> = { 1: 0, 8453: 6, 137: 7, 11155111: 0, 84532: 6, 80002: 7 };
  const domain = domains[chainId];
  if (domain === undefined) throw new Error(`No CCTP domain configured for chain ${chainId}`);
  return domain;
}
