import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPublicClient, http, type Address } from 'viem';
import { AppEnv, cctpDomain, cctpTokenMessenger, getChain, getDestinationChainIds, getToken, mainnetUniswap } from '@paymesh/config';
import {
  routeNotFound,
  createMockDexAdapter,
  createMockBridgeAdapter,
  createV2DexAdapter,
  createUniswapV3Adapter,
  createCctpAdapter,
  createRouteApiAdapter,
  createLifiRouteProvider,
  createOneInchAdapter,
  createAcrossAdapter,
  createCcipAdapter,
  RouteHandler,
  type Quote as EngineQuote,
  type QuoteRequest,
} from '@paymesh/routing-engine';
import { ENV } from '../common/tokens';
import { viemChain } from '../common/chains';
import type { RoutingMetricsService } from '../metrics/routing-metrics.service';

const MAINNET_CHAIN_IDS = new Set([1, 8453, 42161, 10, 137, 43114, 56, 59144]);

export interface RoutingQuoteResult {
  best: EngineQuote;
  alternates: EngineQuote[];
}

export interface RoutingProvider {
  getQuote(req: QuoteRequest): Promise<RoutingQuoteResult>;
}

/**
 * Default routing provider. Real Uniswap V3/V2-compatible DEX routers, CCTP,
 * and external route APIs are supported; mock contracts are only used when
 * explicitly configured.
 */
@Injectable()
export class DefaultRoutingProvider implements RoutingProvider {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Optional() private readonly metrics?: RoutingMetricsService,
  ) {}

  async getQuote(req: QuoteRequest): Promise<RoutingQuoteResult> {
    const destinationChainIds = getDestinationChainIds(this.env);
    if (!destinationChainIds.includes(req.toChain)) {
      throw routeNotFound({ reason: `destination chain ${req.toChain} is not enabled; enabled chains: ${destinationChainIds.join(', ')}` });
    }

    const source = req.fromChain === 11155111
      ? { dex: this.env.PAYMESH_SEPOLIA_DEX_ADDRESS, bridge: this.env.PAYMESH_SEPOLIA_BRIDGE_ADDRESS }
      : req.fromChain === 84532
        ? { dex: this.env.PAYMESH_BASE_SEPOLIA_DEX_ADDRESS, bridge: this.env.PAYMESH_BASE_SEPOLIA_BRIDGE_ADDRESS }
        : { dex: this.env.PAYMESH_DEX_ADDRESS, bridge: this.env.PAYMESH_BRIDGE_ADDRESS };

    const chain = getChain(req.fromChain);
    const publicClient = createPublicClient({ chain: viemChain(req.fromChain), transport: http(chain.rpcUrl) });

    const mainnetDex = mainnetUniswap(req.fromChain);
    const routerAddress = req.fromChain === 11155111
      ? this.env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS
      : req.fromChain === 84532
        ? this.env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS
        : mainnetDex.router ?? '';
    const wrappedNative = req.fromChain === 11155111
      ? this.env.PAYMESH_SEPOLIA_WETH_ADDRESS
      : req.fromChain === 84532
        ? this.env.PAYMESH_BASE_SEPOLIA_WETH_ADDRESS
        : this.env.PAYMESH_WETH_ADDRESS;

    const v3RouterAddress = req.fromChain === 11155111
      ? this.env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
      : req.fromChain === 84532
        ? this.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS
      : mainnetDex.router ?? '';
    const v3QuoterAddress = req.fromChain === 11155111
      ? this.env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
      : req.fromChain === 84532
        ? this.env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS
      : mainnetDex.quoter ?? '';
    const swapAdapters = v3RouterAddress && v3QuoterAddress
      ? [createUniswapV3Adapter({
          publicClient,
          routerAddress: v3RouterAddress as Address,
          quoterAddress: v3QuoterAddress as Address,
          chains: [req.fromChain],
        })]
      : routerAddress && wrappedNative
        ? [createV2DexAdapter({
          publicClient,
          routerAddress: routerAddress as Address,
          wrappedNative: wrappedNative as Address,
          chains: [req.fromChain],
        })]
        : this.env.PAYMESH_ALLOW_MOCK_ROUTES && source.dex
          ? [createMockDexAdapter({ publicClient, dexAddress: source.dex as Address, chains: [req.fromChain] })]
          : [];
    const sourceUsdc = getToken(req.fromChain, 'USDC')?.address;
    const cctpMessenger = cctpTokenMessenger(req.fromChain);
    const destinationUsdc = getToken(req.toChain, 'USDC')?.address;
    // CCTP is only available on Circle-supported domains. Other enabled
    // destinations are handled by LI.FI (or another external provider).
    let destinationDomain: number | undefined;
    try {
      destinationDomain = cctpDomain(req.toChain);
    } catch {
      destinationDomain = undefined;
    }
    const bridgeAdapters = this.env.CCTP_ENABLED && cctpMessenger && sourceUsdc && destinationUsdc && destinationDomain !== undefined
      ? [createCctpAdapter({
          publicClient,
          tokenMessenger: cctpMessenger as Address,
          sourceUsdc: sourceUsdc as Address,
          destinationUsdc: destinationUsdc as Address,
          sourceChainId: req.fromChain,
          destinationChainId: req.toChain,
          destinationDomain,
          maxFee: this.env.CCTP_MAX_FEE,
          minFinalityThreshold: this.env.CCTP_MIN_FINALITY_THRESHOLD,
        })]
      : this.env.PAYMESH_ALLOW_MOCK_ROUTES && source.bridge
        ? [createMockBridgeAdapter({
            publicClient,
            bridgeAddress: source.bridge as Address,
            destChainId: req.toChain,
            supportedFromChains: [req.fromChain],
            supportedToChains: [req.toChain],
          })]
        : [];

    const externalProviders = this.env.ROUTE_PROVIDER_URLS
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((baseUrl) => createRouteApiAdapter({ baseUrl, timeoutMs: this.env.ROUTE_PROVIDER_TIMEOUT_MS }));
    if (this.env.LIFI_ENABLED) {
      externalProviders.push(createLifiRouteProvider({
        baseUrl: this.env.LIFI_API_URL,
        apiKey: this.env.LIFI_API_KEY || undefined,
        integrator: this.env.LIFI_INTEGRATOR,
        timeoutMs: this.env.ROUTE_PROVIDER_TIMEOUT_MS,
      }));
    }

    // Federated provider additions (PRD §Priority Provider List). Each new
    // provider is optional and ranked together with the built-in adapters.
    if (this.env.ONEINCH_ENABLED && this.env.ONEINCH_API_KEY) {
      swapAdapters.push(createOneInchAdapter({
        baseUrl: this.env.ONEINCH_API_URL,
        apiKey: this.env.ONEINCH_API_KEY,
        routerAddress: this.env.ONEINCH_ROUTER_ADDRESS as Address,
        chains: [...MAINNET_CHAIN_IDS],
        timeoutMs: this.env.ROUTE_PROVIDER_TIMEOUT_MS,
      }));
    }
    const mainnetPair = MAINNET_CHAIN_IDS.has(req.fromChain) && MAINNET_CHAIN_IDS.has(req.toChain);
    if (this.env.ACROSS_ENABLED && mainnetPair) {
      bridgeAdapters.push(createAcrossAdapter({
        enabled: true,
        baseUrl: this.env.ACROSS_API_URL,
        integratorId: this.env.ACROSS_INTEGRATOR_ID || undefined,
        apiKey: this.env.ACROSS_API_KEY || undefined,
        timeoutMs: this.env.ROUTE_PROVIDER_TIMEOUT_MS,
      }));
    }
    if (this.env.CCIP_ENABLED) {
      for (const entry of this.env.CCIP_ROUTERS.split(',').map((value) => value.split(':').map((part) => part.trim()))) {
        if (entry.length !== 5 || entry[0] !== String(req.fromChain) || Number(entry[4]) !== req.toChain) continue;
        const tokenEntry = this.env.CCIP_TOKEN.split(',')
          .map((part) => part.split(':').map((value) => value.trim()))
          .find((part) => part[0] === String(req.fromChain));
        const token = tokenEntry?.[1] ?? sourceUsdc;
        if (!token) continue;
        bridgeAdapters.push(createCcipAdapter({
          publicClient,
          routerAddress: entry[1] as Address,
          sourceChainSelector: BigInt(entry[2]!),
          destinationChainSelector: BigInt(entry[3]!),
          sourceChainId: req.fromChain,
          destinationChainId: req.toChain,
          token: token as Address,
          destinationToken: (destinationUsdc ?? token) as Address,
          enabled: true,
        }));
      }
    }

    const handler = new RouteHandler({
      dependencies: {
        swapAdapters,
        bridgeAdapters,
        routeProviders: externalProviders,
        metrics: this.metrics?.metrics,
      },
    });
    const { best, alternates } = await handler.findBestRoute(req);

    return { best, alternates };
  }
}
