import { describe, it, expect } from 'vitest';
import { validateCandidate, validateHopContinuity } from '../src/simulate/validate';
import { estimateBridgeFee, estimateBridgeFeeBps } from '../src/simulate/fees';
import type { CandidateRoute, QuoteRequest } from '../src/types';

const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const req: QuoteRequest = {
  fromChain: 1,
  fromToken: '0x00000000000000000000000000000000000000a1',
  fromAmount: 1_000_000n,
  toChain: 8453,
  toToken: '0x00000000000000000000000000000000000000b2',
  fromAddress: sender,
  toAddress: sender,
  slippageBps: 100,
};

function candidate(overrides: Partial<CandidateRoute> = {}): CandidateRoute {
  return {
    route: [{
      type: 'swap',
      chainId: 1,
      fromToken: req.fromToken,
      toToken: req.toToken,
      amountIn: 1_000_000n,
      amountOut: 990_000n,
      protocol: 'test',
    }],
    estimatedOutput: 990_000n,
    estimatedTimeSeconds: 30,
    estimatedFee: 0n,
    reliability: 0.99,
    priceImpactBps: 0,
    available: true,
    adapterId: 'test',
    transactionRequest: { to: sender, data: '0x', value: 0n },
    hopTransactionRequests: [{ to: sender, data: '0x', value: 0n }],
    ...overrides,
  };
}

describe('validateCandidate', () => {
  it('accepts a healthy candidate', () => {
    expect(validateCandidate(candidate(), req).valid).toBe(true);
  });

  it('rejects unavailable candidates', () => {
    const result = validateCandidate(candidate({ available: false }), req);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toMatch(/unavailable/);
  });

  it('rejects output below the slippage-derived floor', () => {
    // slippageBps=100 → floor 99% → 990_000; drop output below it.
    const result = validateCandidate(candidate({ estimatedOutput: 989_000n }), req);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('floor'))).toBe(true);
  });

  it('rejects excessive price impact', () => {
    const result = validateCandidate(candidate({ priceImpactBps: 500 }), req);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('price impact'))).toBe(true);
  });

  it('supports an explicit minOutputRatioBps floor (PRD hard filter)', () => {
    const result = validateCandidate(candidate(), req, { minOutputRatioBps: 9950 });
    expect(result.valid).toBe(false);
  });
});

describe('validateHopContinuity', () => {
  it('accepts a well-formed swap→bridge route', () => {
    const route = [
      { type: 'approval' as const, chainId: 1, fromToken: req.fromToken, toToken: req.fromToken },
      { type: 'swap' as const, chainId: 1, fromToken: req.fromToken, toToken: '0x...c', amountIn: 1_000_000n, amountOut: 990_000n },
      { type: 'bridge' as const, chainId: 1, fromChain: 1, toChain: 8453, fromToken: '0x...c', toToken: req.toToken, amountIn: 990_000n, amountOut: 989_000n },
    ];
    expect(validateHopContinuity(route, req)).toHaveLength(0);
  });

  it('flags a broken amount chain', () => {
    const route = [
      { type: 'swap' as const, chainId: 1, fromToken: req.fromToken, toToken: '0x...c', amountIn: 1_000_000n, amountOut: 990_000n },
      { type: 'bridge' as const, chainId: 1, fromChain: 1, toChain: 8453, fromToken: '0x...c', toToken: req.toToken, amountIn: 500_000n, amountOut: 499_000n },
    ];
    expect(validateHopContinuity(route, req).length).toBeGreaterThan(0);
  });
});

describe('fees model', () => {
  it('prices CCTP far below standard bridges (PRD comparison table)', () => {
    expect(estimateBridgeFeeBps('cctp-v2-1-8453')).toBe(1);
    expect(estimateBridgeFeeBps('across')).toBe(6);
    expect(estimateBridgeFeeBps('unknown-bridge')).toBe(30);
    expect(estimateBridgeFee(1_000_000n, 'cctp-v2')).toBe(100n);
  });
});
