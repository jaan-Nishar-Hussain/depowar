import { describe, it, expect, vi } from 'vitest';
import { getFallbackQuoteFromHop } from '../src/fallback';
import type { GetQuoteDeps } from '../src/getQuote';
import type { BridgeAdapter, SwapAdapter } from '../src/adapters/types';
import type { QuoteRequest } from '../src/types';

const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const USDT = '0x00000000000000000000000000000000000000a1';
const USDC = '0x00000000000000000000000000000000000000a2';

const req: QuoteRequest = {
  fromChain: 1,
  fromToken: USDT,
  fromAmount: 1_000_000n,
  toChain: 8453,
  toToken: '0x00000000000000000000000000000000000000b2',
  fromAddress: sender,
  toAddress: sender,
};

function makeDeps(): GetQuoteDeps & { swapCalls: string[]; bridgeCalls: string[] } {
  const swapCalls: string[] = [];
  const bridgeCalls: string[] = [];
  const swap: SwapAdapter = {
    id: 'uni',
    supportedChains: [1],
    quoteSwap: async ({ tokenOut }) => {
      swapCalls.push(tokenOut);
      return { amountOut: 990_000n, fee: 0n, timeSeconds: 30, reliability: 0.99, available: true };
    },
    buildSwapTransaction: async () => ({ to: sender, data: '0x', value: 0n, chainId: 1, from: sender }),
    buildApprovalTransaction: async () => ({ to: sender, data: '0x', value: 0n, chainId: 1, from: sender }),
  };
  const bridge: BridgeAdapter = {
    id: 'cctp',
    supportedFromChains: [1],
    supportedToChains: [8453],
    sourceTokenFor: () => USDC,
    quoteBridge: async ({ amountIn }) => {
      bridgeCalls.push(amountIn.toString());
      return { amountOut: amountIn - 1_000n, fee: 1_000n, timeSeconds: 60, reliability: 0.99, available: true };
    },
    buildBridgeTransaction: async () => ({ to: sender, data: '0x', value: 0n, chainId: 1, from: sender }),
    buildApprovalTransaction: async () => ({ to: sender, data: '0x', value: 0n, chainId: 1, from: sender }),
  };
  return { swapAdapters: [swap], bridgeAdapters: [bridge], swapCalls, bridgeCalls };
}

describe('getFallbackQuoteFromHop (partial-route fallback, PRD)', () => {
  it('re-quotes from the intermediate token state, not the original input', async () => {
    const deps = makeDeps();
    const { best } = await getFallbackQuoteFromHop(req, deps, ['across'], {
      // Swap already confirmed: funds are 990_000 USDC on the source chain.
      currentChain: 1,
      currentToken: USDC,
      currentAmount: 990_000n,
      completedHops: 1,
    });

    expect(best.route.map((hop) => hop.type)).toEqual(['approval', 'bridge']);
    expect(best.route[1]?.amountIn).toBe(990_000n);
    // The bridge is quoted for the actual remaining amount (990_000), never
    // the original 1_000_000 input.
    expect(deps.bridgeCalls).toContain('990000');
    expect(deps.bridgeCalls).not.toContain('1000000');
    // No swap leg was re-run: input token already matches the bridge asset.
    expect(deps.swapCalls).toHaveLength(0);
  });

  it('falls back to a full re-quote when the failure happened on hop 0', async () => {
    const deps = makeDeps();
    const { best } = await getFallbackQuoteFromHop(req, deps, [], {
      currentChain: req.fromChain,
      currentToken: req.fromToken,
      currentAmount: req.fromAmount,
      completedHops: 0,
    });
    expect(best.estimatedOutput).toBe(989_000n);
  });

  it('throws ROUTE_NOT_FOUND when every adapter is excluded', async () => {
    const deps = makeDeps();
    await expect(
      getFallbackQuoteFromHop(req, deps, ['uni', 'cctp'], {
        currentChain: 1,
        currentToken: USDC,
        currentAmount: 990_000n,
        completedHops: 1,
      }),
    ).rejects.toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  it('records fallback metrics', async () => {
    const recordFallbackRequote = vi.fn();
    const metrics = {
      recordRouteConsidered: vi.fn(),
      recordRouteChosen: vi.fn(),
      recordRouteDiscarded: vi.fn(),
      recordQuoteLatency: vi.fn(),
      recordFallbackRequote,
    };
    const deps = makeDeps();
    await getFallbackQuoteFromHop(req, { ...deps, metrics }, [], {
      currentChain: 1,
      currentToken: USDC,
      currentAmount: 990_000n,
      completedHops: 1,
    });
    expect(recordFallbackRequote).toHaveBeenCalledWith(1, 'ok');
  });
});
