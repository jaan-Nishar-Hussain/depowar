import { createPublicClient, http, type Address, type Chain, type PublicClient } from 'viem';
import { type AppEnv } from '@paymesh/config';
import { createMockDexAdapter } from './adapters/dex/mockDexAdapter';
import { createMockBridgeAdapter } from './adapters/bridge/mockBridgeAdapter';
import { createV2DexAdapter } from './adapters/dex/v2DexAdapter';
import { createUniswapV3Adapter } from './adapters/dex/uniswapV3Adapter';
import { createOneInchAdapter } from './adapters/dex/oneInchAdapter';
import { createCctpAdapter } from './adapters/bridge/cctpAdapter';
import { createAcrossAdapter } from './adapters/bridge/acrossAdapter';
import { createCcipAdapter } from './adapters/bridge/ccipAdapter';
import type { GetQuoteDeps } from './getQuote';
import type { BridgeAdapter, SwapAdapter } from './adapters/types';

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
  /** Optional env-derived federated providers (1inch, Across, CCIP). */
  env?: AppEnv;
}

/**
 * The full mainnet chain set registered in `@paymesh/config` (Next-Gen Routing
 * PRD §Scope: 8 source + 8 destination chains). Every federated provider must
 * use this single source of truth so BNB, zkSync, and Monad are never
 * silently excluded from routing.
 */
export const MAINNET_CHAIN_IDS = new Set([1, 8453, 42161, 10, 137, 43114, 56, 59144, 143, 324]);

/**
 * Federated swap-adapter builder (single source of truth for the API and the
 * worker). 1inch is added when enabled and an API key is present.
 */
export function createFederatedSwapAdapters(env: AppEnv | undefined, timeoutMs = 8_000): SwapAdapter[] {
  if (!env?.ONEINCH_ENABLED || !env.ONEINCH_API_KEY) return [];
  return [createOneInchAdapter({
    baseUrl: env.ONEINCH_API_URL,
    apiKey: env.ONEINCH_API_KEY,
    routerAddress: env.ONEINCH_ROUTER_ADDRESS as Address,
    chains: [...MAINNET_CHAIN_IDS],
    timeoutMs,
  })];
}

/**
 * Federated bridge-adapter builder. Across is mainnet-only and inert on
 * testnets; CCIP is a disabled-by-default backup rail. `sourceChainId` /
 * `destChainId` gate which providers apply to the current pair.
 */
export function createFederatedBridgeAdapters(
  env: AppEnv | undefined,
  sourceChainId: number,
  destChainId: number,
  publicClient: PublicClient,
  destinationUsdc?: string,
  sourceUsdc?: string,
  timeoutMs = 8_000,
): BridgeAdapter[] {
  const adapters: BridgeAdapter[] = [];
  if (env?.ACROSS_ENABLED && MAINNET_CHAIN_IDS.has(sourceChainId) && MAINNET_CHAIN_IDS.has(destChainId)) {
    adapters.push(createAcrossAdapter({
      enabled: true,
      baseUrl: env.ACROSS_API_URL,
      integratorId: env.ACROSS_INTEGRATOR_ID || undefined,
      apiKey: env.ACROSS_API_KEY || undefined,
      timeoutMs,
    }));
  }
  if (env?.CCIP_ENABLED) {
    for (const entry of env.CCIP_ROUTERS.split(',').map((value) => value.split(':').map((part) => part.trim()))) {
      if (entry.length !== 5 || entry[0] !== String(sourceChainId) || Number(entry[4]) !== destChainId) continue;
      const tokenEntry = env.CCIP_TOKEN.split(',')
        .map((part) => part.split(':').map((value) => value.trim()))
        .find((part) => part[0] === String(sourceChainId));
      const token = tokenEntry?.[1] ?? sourceUsdc;
      if (!token) continue;
      adapters.push(createCcipAdapter({
        publicClient,
        routerAddress: entry[1] as Address,
        sourceChainSelector: BigInt(entry[2]!),
        destinationChainSelector: BigInt(entry[3]!),
        sourceChainId,
        destinationChainId: destChainId,
        token: token as Address,
        destinationToken: (destinationUsdc ?? token) as Address,
        enabled: true,
      }));
    }
  }
  return adapters;
}

/**
 * Builds an env-driven adapter set. A configured Uniswap V3 deployment is
 * preferred, then a V2-compatible router; mocks remain local fixtures.
 * Federated providers (1inch, Across, CCIP) are added when their env flags
 * allow it — Across is mainnet-only, CCIP is a disabled-by-default backup rail.
 */
export function createDefaultAdapters(config: AdapterConfig): GetQuoteDeps {
  const chain: Chain = {
    id: config.sourceChainId,
    name: `chain-${config.sourceChainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const env = config.env;

  const swapAdapterList = [config.uniswapV3RouterAddress && config.uniswapV3QuoterAddress
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
          : undefined].filter((adapter): adapter is NonNullable<typeof adapter> => !!adapter);
  swapAdapterList.push(...createFederatedSwapAdapters(env));

  const bridgeAdapterList = config.cctpEnabled !== false && config.cctpTokenMessenger && config.sourceUsdc && config.destinationUsdc
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
        ] : [];
  bridgeAdapterList.push(...createFederatedBridgeAdapters(
    env,
    config.sourceChainId,
    config.destChainId,
    publicClient,
    config.destinationUsdc,
    config.sourceUsdc,
  ));

  return {
    swapAdapters: swapAdapterList,
    bridgeAdapters: bridgeAdapterList,
  };
}
