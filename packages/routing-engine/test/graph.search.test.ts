import { describe, it, expect } from 'vitest';
import { searchComposedRoutes } from '../src/graph/search';
import type { GetQuoteDeps } from '../src/getQuote';
import type { BridgeAdapter, SwapAdapter, SwapQuote, BridgeQuote } from '../src/adapters/types';
import type { QuoteRequest, TransactionRequest } from '../src/types';

const TOKENS = {
  usdt: '0x00000000000000000000000000000000000000a1',
  usdc: '0x00000000000000000000000000000000000000a2',
  destUsdc: '0x00000000000000000000000000000000000000b2',
  other: '0x00000000000000000000000000000000000000a3',
};

const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

const req: QuoteRequest = {
  fromChain: 1,
  fromToken: TOKENS.usdt,
  fromAmount: 1_000_000n,
  toChain: 8453,
  toToken: TOKENS.destUsdc,
  fromAddress: sender,
  toAddress: recipient,
  slippageBps: 100,
};

function fakeTx(): TransactionRequest {
  return { to: sender, data: '0x', value: 0n, chainId: 1, from: sender };
}

function makeSwap(id: string, supported: number[], quote: (tokenOut: string) => SwapQuote | null, withApproval = true): SwapAdapter {
  return {
    id,
    supportedChains: supported,
    quoteSwap: async ({ tokenOut }) => quote(tokenOut) ?? { amountOut: 0n, fee: 0n, timeSeconds: 0, reliability: 0, available: false },
    buildSwapTransaction: async () => fakeTx(),
    buildApprovalTransaction: withApproval
      ? async () => fakeTx()
      : undefined,
  };
}

function makeBridge(id: string, opts: { from: number[]; to: number[]; sourceToken?: string; quote: (amountIn: bigint) => BridgeQuote }): BridgeAdapter {
  return {
    id,
    supportedFromChains: opts.from,
    supportedToChains: opts.to,
    quoteBridge: async ({ amountIn }) => opts.quote(amountIn),
    buildBridgeTransaction: async () => ({ ...fakeTx(), to: recipient }),
    buildApprovalTransaction: async () => fakeTx(),
    sourceTokenFor: opts.sourceToken ? () => opts.sourceToken! : undefined,
  };
}

const usdtToUsdc: SwapQuote = { amountOut: 990_000n, fee: 0n, timeSeconds: 30, reliability: 0.99, priceImpactBps: 10, available: true };
const bridgeQuote: BridgeQuote = { amountOut: 989_000n, fee: 1_000n, timeSeconds: 60, reliability: 0.99, available: true };

describe('searchComposedRoutes', () => {
  it('composes swap → mapped-bridge when the input token differs from the bridge asset', async () => {
    const deps: GetQuoteDeps = {
      swapAdapters: [makeSwap('uni', [1], (tokenOut) => (tokenOut.toLowerCase() === TOKENS.usdc.toLowerCase() ? usdtToUsdc : null))],
      bridgeAdapters: [makeBridge('cctp', { from: [1], to: [8453], sourceToken: TOKENS.usdc, quote: () => bridgeQuote })],
    };

    const candidates = await searchComposedRoutes(req, deps);
    expect(candidates.length).toBeGreaterThan(0);
    const best = candidates[0]!;
    const types = best.route.map((hop) => hop.type);
    expect(types).toEqual(['approval', 'swap', 'approval', 'bridge']);
    // Index-aligned transactions.
    expect(best.hopTransactionRequests).toHaveLength(best.route.length);
    expect(best.estimatedOutput).toBe(989_000n);
    expect(best.estimatedFee).toBe(1_000n);
    expect(best.adapterId.startsWith('graph:')).toBe(true);
  });

  it('composes pass-through bridge when the input token maps to the bridge asset', async () => {
    const passThroughReq: QuoteRequest = { ...req, fromToken: TOKENS.other };
    const deps: GetQuoteDeps = {
      swapAdapters: [],
      // Same-asset bridge carrying TOKENS.other across chains.
      bridgeAdapters: [makeBridge('mock-bridge', { from: [1], to: [8453], sourceToken: TOKENS.other, quote: () => ({ ...bridgeQuote, fee: 0n }) })],
    };

    const candidates = await searchComposedRoutes(passThroughReq, deps);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.route.map((hop) => hop.type)).toEqual(['approval', 'bridge']);
    expect(candidates[0]!.estimatedOutput).toBe(989_000n);
  });

  it('never bridges a token the pass-through bridge cannot carry', async () => {
    const deps: GetQuoteDeps = {
      swapAdapters: [],
      // No sourceTokenFor: a same-asset bridge that only carries the
      // destination token itself. USDT input must not be bridged directly.
      bridgeAdapters: [makeBridge('mock-bridge', { from: [1], to: [8453], quote: () => ({ ...bridgeQuote, fee: 0n }) })],
    };
    const candidates = await searchComposedRoutes(req, deps);
    expect(candidates).toHaveLength(0);
  });

  it('memoizes repeated quotes across alternative explorations', async () => {
    let quoteCalls = 0;
    const countingSwap: SwapAdapter = {
      ...makeSwap('uni', [1], () => usdtToUsdc),
      quoteSwap: async () => {
        quoteCalls += 1;
        return usdtToUsdc;
      },
    };
    const deps: GetQuoteDeps = {
      swapAdapters: [countingSwap],
      // Two bridges both need USDC; the swap toward USDC is explored once per
      // branch and must therefore be quoted exactly once (shared cache).
      bridgeAdapters: [
        makeBridge('cctp-a', { from: [1], to: [8453], sourceToken: TOKENS.usdc, quote: () => bridgeQuote }),
        makeBridge('cctp-b', { from: [1], to: [8453], sourceToken: TOKENS.usdc, quote: () => ({ ...bridgeQuote, amountOut: 988_000n, fee: 2_000n }) }),
      ],
    };
    const candidates = await searchComposedRoutes(req, deps);
    expect(candidates.length).toBe(2);
    // USDT → USDC quoted exactly once despite two bridge branches exploring it.
    expect(quoteCalls).toBe(1);
  });

  it('yields nothing when no path reaches the destination', async () => {
    const deps: GetQuoteDeps = {
      swapAdapters: [makeSwap('uni', [1], () => usdtToUsdc)],
      bridgeAdapters: [makeBridge('cctp', { from: [137], to: [8453], sourceToken: TOKENS.usdc, quote: () => bridgeQuote })],
    };
    const candidates = await searchComposedRoutes(req, deps);
    expect(candidates).toHaveLength(0);
  });

  it('respects maxHops', async () => {
    const deps: GetQuoteDeps = {
      swapAdapters: [makeSwap('uni', [1], () => usdtToUsdc)],
      bridgeAdapters: [makeBridge('cctp', { from: [1], to: [8453], sourceToken: TOKENS.usdc, quote: () => bridgeQuote })],
    };
    const candidates = await searchComposedRoutes(req, deps, { maxHops: 1 });
    expect(candidates).toHaveLength(0);
  });
});
