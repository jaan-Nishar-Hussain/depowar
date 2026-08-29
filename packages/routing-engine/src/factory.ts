import { createPublicClient, http, type Address, type Chain } from 'viem';
import { createMockDexAdapter } from './adapters/dex/mockDexAdapter';
import { createMockBridgeAdapter } from './adapters/bridge/mockBridgeAdapter';
import type { GetQuoteDeps } from './getQuote';

export interface AdapterConfig {
  rpcUrl: string;
  sourceChainId: number;
  dexAddress: Address;
  bridgeAddress: Address;
  destChainId: number;
}

/**
 * Builds the default adapter set (MockDEX + MockBridge) shared by the API's
 * routing provider and the worker's fallback/settlement logic. Env-driven.
 */
export function createDefaultAdapters(config: AdapterConfig): GetQuoteDeps {
  const chain: Chain = {
    id: config.sourceChainId,
    name: `chain-${config.sourceChainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

  return {
    swapAdapters: [
      createMockDexAdapter({
        publicClient,
        dexAddress: config.dexAddress,
        chains: [config.sourceChainId],
      }),
    ],
    bridgeAdapters: [
      createMockBridgeAdapter({
        publicClient,
        bridgeAddress: config.bridgeAddress,
        destChainId: config.destChainId,
        supportedFromChains: [config.sourceChainId],
      }),
    ],
  };
}