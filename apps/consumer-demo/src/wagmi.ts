import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { base } from 'viem/chains';

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [injected({ target: 'metaMask' })],
  transports: {
    [base.id]: http(import.meta.env.VITE_BASE_RPC),
  },
});
