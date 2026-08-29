import { Chain as ViemChain } from 'viem';
import { getChain } from '@paymesh/config';

/** Builds a viem Chain from the config registry (resolves the RPC URL). */
export function viemChain(chainId: number): ViemChain {
  const info = getChain(chainId);
  return {
    id: info.id,
    name: info.name,
    nativeCurrency: info.nativeCurrency,
    rpcUrls: { default: { http: [info.rpcUrl] } },
  };
}