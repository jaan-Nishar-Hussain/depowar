import { createConfig, http, type Config } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { base, polygon } from 'viem/chains';

/**
 * Platform defaults for the wallet read/switch layer. Consumers should not
 * need to configure chain RPC URLs; they only provide their Depowar API key.
 * Production deployments can replace these internally with platform-owned
 * RPC infrastructure without changing the consumer integration.
 */
const DEFAULT_RPC_URLS: Record<number, string> = {
  [base.id]: 'https://mainnet.base.org',
  // polygon-rpc.com now returns 401 for browser requests. Use the current
  // Polygon-listed public endpoint until the platform RPC gateway is used.
  [polygon.id]: 'https://polygon.drpc.org',
};

export function createPayMeshWagmiConfig(): Config {
  return createConfig({
    chains: [base, polygon],
    connectors: [injected({ target: 'metaMask' })],
    transports: {
      [base.id]: http(DEFAULT_RPC_URLS[base.id]),
      [polygon.id]: http(DEFAULT_RPC_URLS[polygon.id]),
    },
  });
}
