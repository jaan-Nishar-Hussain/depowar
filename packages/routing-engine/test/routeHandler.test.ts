import { describe, expect, it } from 'vitest';
import { RouteHandler } from '../src/routeHandler';
import type { BridgeAdapter, SwapAdapter } from '../src/adapters/types';
import type { QuoteRequest } from '../src/types';

const request: QuoteRequest = {
  fromChain: 11155111,
  fromToken: '0x1111111111111111111111111111111111111111',
  fromAmount: 100_000_000n,
  toChain: 80002,
  toToken: '0x2222222222222222222222222222222222222222',
  fromAddress: '0x3333333333333333333333333333333333333333',
  toAddress: '0x4444444444444444444444444444444444444444',
};

function swap(id: string, amountOut: bigint): SwapAdapter {
  return {
    id,
    supportedChains: [11155111],
    quoteSwap: async () => ({ amountOut, fee: 1n, timeSeconds: 10, reliability: 1, liquidityScore: 1 }),
    buildSwapTransaction: async () => ({
      to: '0x5555555555555555555555555555555555555555',
      data: '0x',
      value: 0n,
      chainId: 11155111,
    }),
  };
}

function bridge(id: string, fee: bigint): BridgeAdapter {
  return {
    id,
    supportedFromChains: [11155111],
    supportedToChains: [80002],
    quoteBridge: async ({ amountIn }) => ({ amountOut: amountIn - fee, fee, timeSeconds: 20, reliability: 1, liquidityScore: 1 }),
    buildBridgeTransaction: async () => ({
      to: '0x6666666666666666666666666666666666666666',
      data: '0x',
      value: 0n,
      chainId: 11155111,
    }),
  };
}

describe('RouteHandler', () => {
  it('evaluates every swap and bridge combination and returns alternatives', async () => {
    const handler = new RouteHandler({
      dependencies: {
        swapAdapters: [swap('cheap-swap', 99_000_000n), swap('deep-swap', 99_900_000n)],
        bridgeAdapters: [bridge('bridge-a', 100n)],
      },
    });

    const result = await handler.findBestRoute(request);
    expect(result.best.route[0]?.protocol).toBe('deep-swap');
    expect(result.best.route[1]?.protocol).toBe('bridge-a');
    expect(result.alternates.length).toBe(1);
  });

  it('skips an unavailable bridge', async () => {
    const unavailable = bridge('down', 1n);
    unavailable.healthCheck = async () => ({ available: false, reason: 'maintenance' });
    const handler = new RouteHandler({
      dependencies: { swapAdapters: [swap('swap', 99_000_000n)], bridgeAdapters: [unavailable] },
    });
    await expect(handler.findBestRoute(request)).rejects.toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  it('keeps ERC-20 approvals aligned with executable route hops', async () => {
    const swapAdapter = swap('swap-with-approval', 99_000_000n);
    swapAdapter.buildApprovalTransaction = async () => ({
      to: '0x7777777777777777777777777777777777777777', data: '0x01', value: 0n, chainId: 11155111,
    });
    const bridgeAdapter = bridge('bridge-with-approval', 100n);
    bridgeAdapter.buildApprovalTransaction = async () => ({
      to: '0x8888888888888888888888888888888888888888', data: '0x02', value: 0n, chainId: 11155111,
    });
    const handler = new RouteHandler({ dependencies: { swapAdapters: [swapAdapter], bridgeAdapters: [bridgeAdapter] } });
    const result = await handler.findBestRoute(request);
    expect(result.best.route.map((hop) => hop.type)).toEqual(['approval', 'swap', 'approval', 'bridge']);
    expect(result.best.hopTransactionRequests).toHaveLength(4);
  });
});
