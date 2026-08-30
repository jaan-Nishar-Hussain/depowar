import { createPublicClient, http, type Address, type Chain } from 'viem';
import { createMockDexAdapter } from './adapters/dex/mockDexAdapter';
import { createMockBridgeAdapter } from './adapters/bridge/mockBridgeAdapter';
import { createV2DexAdapter } from './adapters/dex/v2DexAdapter';
import { createUniswapV3Adapter } from './adapters/dex/uniswapV3Adapter';
import { createCctpAdapter } from './adapters/bridge/cctpAdapter';
import type { GetQuoteDeps } from './getQuote';

export interface AdapterConfig {
  rpcUrl: string;
  sourceChainId: number;
  dexAddress?: Address;
  bridgeAddress?: Address;
  destChainId: number;
  dexRouterAddress?: Address;
  wrappedNative?: Address;
  uniswapV3RouterAddress?: Address;
  uniswapV3QuoterAddress?: Address;
  cctpTokenMessenger?: Address;
  sourceUsdc?: Address;
  destinationUsdc?: Address;
  cctpEnabled?: boolean;
  cctpDestinationDomain?: number;
  cctpMaxFee?: bigint;
  cctpMinFinalityThreshold?: number;
  allowMock?: boolean;
}

/**
 * Builds an env-driven adapter set. A configured Uniswap V3 deployment is
 * preferred, then a V2-compatible router; mocks remain local fixtures.
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
    swapAdapters: [config.uniswapV3RouterAddress && config.uniswapV3QuoterAddress
      ? createUniswapV3Adapter({
          publicClient,
          routerAddress: config.uniswapV3RouterAddress,
          quoterAddress: config.uniswapV3QuoterAddress,
          chains: [config.sourceChainId],
        })
      : config.dexRouterAddress && config.wrappedNative
        ? createV2DexAdapter({
          publicClient,
          routerAddress: config.dexRouterAddress,
          wrappedNative: config.wrappedNative,
          chains: [config.sourceChainId],
        })
        : config.allowMock !== false && config.dexAddress
          ? createMockDexAdapter({
              publicClient,
              dexAddress: config.dexAddress,
              chains: [config.sourceChainId],
            })
          : undefined].filter((adapter): adapter is NonNullable<typeof adapter> => !!adapter),
    bridgeAdapters: config.cctpEnabled !== false && config.cctpTokenMessenger && config.sourceUsdc && config.destinationUsdc
      ? [createCctpAdapter({
          publicClient,
          tokenMessenger: config.cctpTokenMessenger,
          sourceUsdc: config.sourceUsdc,
          destinationUsdc: config.destinationUsdc,
          sourceChainId: config.sourceChainId,
          destinationChainId: config.destChainId,
          destinationDomain: config.cctpDestinationDomain ?? 7,
          maxFee: config.cctpMaxFee,
          minFinalityThreshold: config.cctpMinFinalityThreshold,
        })]
      : config.allowMock !== false && config.bridgeAddress ? [
          createMockBridgeAdapter({
            publicClient,
            bridgeAddress: config.bridgeAddress,
            destChainId: config.destChainId,
            supportedFromChains: [config.sourceChainId],
          }),
        ] : [],
  };
}
