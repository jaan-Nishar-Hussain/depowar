import { Chain as ViemChain } from 'viem';
import { getChain } from '@paymesh/config';

export function viemChain(chainId: number): ViemChain {
  const info = getChain(chainId);
  return {
    id: info.id,
    name: info.name,
    nativeCurrency: info.nativeCurrency,
    rpcUrls: { default: { http: [info.rpcUrl] } },
  };
}