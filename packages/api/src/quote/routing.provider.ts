import { Inject, Injectable } from '@nestjs/common';
import { createPublicClient, http, type Address } from 'viem';
import { AppEnv, getChain } from '@paymesh/config';
import {
  getQuote as engineGetQuote,
  routeNotFound,
  createMockDexAdapter,
  createMockBridgeAdapter,
  type Quote as EngineQuote,
  type QuoteRequest,
} from '@paymesh/routing-engine';
import { ENV } from '../common/tokens';
import { viemChain } from '../common/chains';

export interface RoutingQuoteResult {
  best: EngineQuote;
  alternates: EngineQuote[];
}

export interface RoutingProvider {
  getQuote(req: QuoteRequest): Promise<RoutingQuoteResult>;
}

/**
 * Default routing provider: wraps the routing engine with the MockDEX /
 * MockBridge adapters wired to the contract addresses configured in env.
 * For local dev these come from the Anvil deploy; on testnets they come from
 * the real testnet deploy.
 */
@Injectable()
export class DefaultRoutingProvider implements RoutingProvider {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async getQuote(req: QuoteRequest): Promise<RoutingQuoteResult> {
    if (req.toChain !== this.env.PAYMESH_DEST_CHAIN_ID) {
      throw routeNotFound({ reason: `settlement is restricted to chain ${this.env.PAYMESH_DEST_CHAIN_ID}` });
    }

    const source = req.fromChain === 11155111
      ? { dex: this.env.PAYMESH_SEPOLIA_DEX_ADDRESS, bridge: this.env.PAYMESH_SEPOLIA_BRIDGE_ADDRESS }
      : req.fromChain === 84532
        ? { dex: this.env.PAYMESH_BASE_SEPOLIA_DEX_ADDRESS, bridge: this.env.PAYMESH_BASE_SEPOLIA_BRIDGE_ADDRESS }
        : { dex: this.env.PAYMESH_DEX_ADDRESS, bridge: this.env.PAYMESH_BRIDGE_ADDRESS };

    if (!source.dex || !source.bridge) {
      throw routeNotFound({
        reason: `routing contracts not configured for source chain ${req.fromChain}`,
      });
    }

    const chain = getChain(req.fromChain);
    const publicClient = createPublicClient({ chain: viemChain(req.fromChain), transport: http(chain.rpcUrl) });

    const swapAdapter = createMockDexAdapter({
      publicClient,
      dexAddress: source.dex as Address,
      chains: [req.fromChain],
    });
    const bridgeAdapter = createMockBridgeAdapter({
      publicClient,
      bridgeAddress: source.bridge as Address,
      destChainId: this.env.PAYMESH_DEST_CHAIN_ID,
      supportedFromChains: [req.fromChain],
      supportedToChains: [req.toChain],
    });

    const { best, alternates } = await engineGetQuote(req, {
      swapAdapters: [swapAdapter],
      bridgeAdapters: [bridgeAdapter],
    });

    return { best, alternates };
  }
}
