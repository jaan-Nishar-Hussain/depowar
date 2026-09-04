import { listChains } from './chains';
import { cctpDomain, cctpMessageTransmitter, cctpTokenMessenger, mainnetUniswap } from './mainnet';
import { getEnv, getDestinationChainIds, type AppEnv } from './env';

export interface ChainPairCoverage {
  fromChainId: number;
  toChainId: number;
  /** A same-chain or cross-chain swap leg is configured on the source chain. */
  swapConfigured: boolean;
  /** Circle CCTP is configured for this exact source→destination pair. */
  nativeBridgeConfigured: boolean;
  /** A federated bridge (Across, CCIP) is enabled and could plausibly serve this pair. */
  federatedBridgeConfigured: boolean;
  /** A generic HTTP route provider (LI.FI, ROUTE_PROVIDER_URLS) is enabled. */
  externalProviderConfigured: boolean;
  /**
   * Best-effort "would attempt a quote" signal derived purely from
   * configuration presence — this is NOT a guarantee of live liquidity or a
   * successful quote (that requires an actual RPC call). It answers the
   * Next-Gen Routing PRD's "Coverage: % of input token/chain combos
   * successfully served" question at the configuration level, which is the
   * cheap, always-available half of that metric; the other half (whether a
   * live quote actually succeeds) is tracked by the routing metrics counters
   * exposed at `GET /v1/metrics`.
   */
  routable: boolean;
}

const ACROSS_DEFAULT_CHAINS = new Set([1, 8453, 42161, 10, 137, 43114, 56, 59144]);

/** Mirrors the swap-adapter selection precedence in `DefaultRoutingProvider` without needing a live RPC client. */
function isSwapConfigured(chainId: number, env: AppEnv): boolean {
  if (chainId === 11155111) {
    return Boolean(
      (env.PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && env.PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS) ||
        (env.PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS && env.PAYMESH_SEPOLIA_WETH_ADDRESS) ||
        (env.PAYMESH_ALLOW_MOCK_ROUTES && env.PAYMESH_SEPOLIA_DEX_ADDRESS) ||
        (env.ONEINCH_ENABLED && env.ONEINCH_API_KEY),
    );
  }
  if (chainId === 84532) {
    return Boolean(
      (env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS && env.PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS) ||
        (env.PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS && env.PAYMESH_BASE_SEPOLIA_WETH_ADDRESS) ||
        (env.PAYMESH_ALLOW_MOCK_ROUTES && env.PAYMESH_BASE_SEPOLIA_DEX_ADDRESS) ||
        (env.ONEINCH_ENABLED && env.ONEINCH_API_KEY),
    );
  }
  const mainnetDex = mainnetUniswap(chainId);
  return Boolean(
    (mainnetDex.router && mainnetDex.quoter) ||
      (env.PAYMESH_ALLOW_MOCK_ROUTES && env.PAYMESH_DEX_ADDRESS) ||
      (env.ONEINCH_ENABLED && env.ONEINCH_API_KEY),
  );
}

function isCctpConfigured(fromChainId: number, toChainId: number, env: AppEnv): boolean {
  if (!env.CCTP_ENABLED) return false;
  const messenger = cctpTokenMessenger(fromChainId);
  const transmitter = cctpMessageTransmitter(toChainId);
  if (!messenger || !transmitter) return false;
  try {
    cctpDomain(fromChainId);
    cctpDomain(toChainId);
    return true;
  } catch {
    return false;
  }
}

function isFederatedBridgeConfigured(fromChainId: number, toChainId: number, env: AppEnv): boolean {
  if (env.ACROSS_ENABLED && ACROSS_DEFAULT_CHAINS.has(fromChainId) && ACROSS_DEFAULT_CHAINS.has(toChainId)) {
    return true;
  }
  if (env.CCIP_ENABLED) {
    return env.CCIP_ROUTERS.split(',').some((entry) => {
      const parts = entry.split(':').map((p) => p.trim());
      return parts.length === 5 && parts[0] === String(fromChainId) && Number(parts[4]) === toChainId;
    });
  }
  return false;
}

function isExternalProviderConfigured(env: AppEnv): boolean {
  return env.LIFI_ENABLED || env.ROUTE_PROVIDER_URLS.split(',').some((url) => url.trim().length > 0);
}

/**
 * Computes configuration-level route coverage across every registered chain
 * as a source and every enabled destination chain. Pure and synchronous — no
 * network calls — so it's cheap to expose on every request.
 */
export function getCoverageMatrix(env: AppEnv = getEnv()): ChainPairCoverage[] {
  const sources = listChains();
  const destinations = getDestinationChainIds(env);
  const matrix: ChainPairCoverage[] = [];

  for (const source of sources) {
    for (const toChainId of destinations) {
      const swapConfigured = isSwapConfigured(source.id, env);
      const nativeBridgeConfigured = isCctpConfigured(source.id, toChainId, env);
      const federatedBridgeConfigured = isFederatedBridgeConfigured(source.id, toChainId, env);
      const externalProviderConfigured = isExternalProviderConfigured(env);
      const sameChain = source.id === toChainId;
      matrix.push({
        fromChainId: source.id,
        toChainId,
        swapConfigured,
        nativeBridgeConfigured,
        federatedBridgeConfigured,
        externalProviderConfigured,
        routable: (sameChain && swapConfigured) || nativeBridgeConfigured || federatedBridgeConfigured || externalProviderConfigured,
      });
    }
  }
  return matrix;
}

/** Rolls the matrix up into the PRD's "Coverage: % of combos served" metric. */
export function coverageSummary(matrix: ChainPairCoverage[] = getCoverageMatrix()): {
  totalPairs: number;
  routablePairs: number;
  coverageRatio: number;
} {
  const routablePairs = matrix.filter((pair) => pair.routable).length;
  return {
    totalPairs: matrix.length,
    routablePairs,
    coverageRatio: matrix.length > 0 ? routablePairs / matrix.length : 0,
  };
}
