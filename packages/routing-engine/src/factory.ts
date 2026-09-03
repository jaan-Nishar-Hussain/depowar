import { createPublicClient, http, type Address, type Chain } from 'viem';
import { ccipRouterConfigs, type AppEnv } from '@paymesh/config';
import { createMockDexAdapter } from './adapters/dex/mockDexAdapter';
import { createMockBridgeAdapter } from './adapters/bridge/mockBridgeAdapter';
import { createV2DexAdapter } from './adapters/dex/v2DexAdapter';
import { createUniswapV3Adapter } from './adapters/dex/uniswapV3Adapter';
import { createOneInchAdapter } from './adapters/dex/oneInchAdapter';
import { createCctpAdapter } from './adapters/bridge/cctpAdapter';
import { createAcrossAdapter } from './adapters/bridge/acrossAdapter';
import { createCcipAdapter } from './adapters/bridge/ccipAdapter';
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
  /** Optional env-derived federated providers (1inch, Across, CCIP). */
  env?: AppEnv;
}

const MAINNET_CHAIN_IDS = new Set([1, 8453, 42161, 10, 137, 43114, 56, 59144]);

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

  // Tier-2 federated DEX aggregator (PRD). Only when enabled and configured.
  if (env?.ONEINCH_ENABLED && env.ONEINCH_API_KEY) {
    swapAdapterList.push(createOneInchAdapter({
      baseUrl: env.ONEINCH_API_URL,
      apiKey: env.ONEINCH_API_KEY,
      routerAddress: env.ONEINCH_ROUTER_ADDRESS as Address,
      chains: [...MAINNET_CHAIN_IDS],
    }));
  }

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

  // Tier-1 intent bridge (PRD): mainnet-only, explicitly enabled.
  if (env?.ACROSS_ENABLED && MAINNET_CHAIN_IDS.has(config.sourceChainId) && MAINNET_CHAIN_IDS.has(config.destChainId)) {
    bridgeAdapterList.push(createAcrossAdapter({
      enabled: true,
      baseUrl: env.ACROSS_API_URL,
      integratorId: env.ACROSS_INTEGRATOR_ID || undefined,
      apiKey: env.ACROSS_API_KEY || undefined,
    }));
  }

  // Backup rail (PRD Tier-3): CCIP, disabled unless explicitly configured.
  // CCIP_ROUTERS entries: "<chainId>:<router>:<sourceSelector>:<destSelector>:<destChainId>".
  if (env?.CCIP_ENABLED) {
    for (const entry of env.CCIP_ROUTERS.split(',').map((value) => value.split(':').map((part) => part.trim()))) {
      if (entry.length !== 5 || entry[0] !== String(config.sourceChainId)) continue;
      const tokenEntry = env.CCIP_TOKEN.split(',')
        .map((part) => part.split(':').map((value) => value.trim()))
        .find((part) => part[0] === String(config.sourceChainId));
      const token = tokenEntry?.[1] ?? config.sourceUsdc;
      if (!token) continue;
      bridgeAdapterList.push(createCcipAdapter({
        publicClient,
        routerAddress: entry[1] as Address,
        sourceChainSelector: BigInt(entry[2]!),
        destinationChainSelector: BigInt(entry[3]!),
        sourceChainId: config.sourceChainId,
        destinationChainId: Number(entry[4]),
        token: token as Address,
        destinationToken: (config.destinationUsdc ?? token) as Address,
        enabled: true,
      }));
    }
  }

  return {
    swapAdapters: swapAdapterList,
    bridgeAdapters: bridgeAdapterList,
  };
}
