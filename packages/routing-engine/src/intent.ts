import type { QuoteRequest, CandidateRoute } from './types';

/**
 * Standard EIP-712 structured intent payload for off-chain solver and RFQ auctions
 * (PRD §Route Graph: "Intent-aware: Enables future 'solver' or RFQ integrations").
 */
export interface SolverIntent {
  intentId: string;
  sender: string;
  recipient: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
  nonce: string;
}

export function buildSolverIntent(
  req: QuoteRequest,
  bestRoute?: CandidateRoute,
  options: { deadlineSeconds?: number; nonce?: string } = {},
): SolverIntent {
  const minOut = bestRoute
    ? (bestRoute.estimatedOutput * BigInt(10_000 - (req.slippageBps ?? 50))) / 10_000n
    : (req.fromAmount * 99n) / 100n;

  return {
    intentId: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sender: req.fromAddress ?? '0x0000000000000000000000000000000000000000',
    recipient: req.toAddress ?? req.fromAddress ?? '0x0000000000000000000000000000000000000000',
    fromChainId: req.fromChain,
    toChainId: req.toChain,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.fromAmount.toString(),
    minAmountOut: minOut.toString(),
    deadline: Math.floor(Date.now() / 1000) + (options.deadlineSeconds ?? 300),
    nonce: options.nonce ?? Date.now().toString(),
  };
}

/**
 * Multi-path volume splitting analysis (PRD §Rollout Roadmap Phase 4).
 * Evaluates whether splitting across multiple candidate bridges provides
 * better price impact / liquidity distribution for large amounts.
 */
export interface MultiPathSplit {
  adapterId: string;
  allocationBps: number;
  allocatedAmount: bigint;
  estimatedOutput: bigint;
}

export function evaluateMultiPathSplits(
  amountIn: bigint,
  candidates: CandidateRoute[],
): MultiPathSplit[] {
  if (candidates.length <= 1 || amountIn < 50_000_000_000n) {
    return candidates.slice(0, 1).map((c) => ({
      adapterId: c.adapterId ?? 'primary',
      allocationBps: 10_000,
      allocatedAmount: amountIn,
      estimatedOutput: c.estimatedOutput,
    }));
  }

  const top2 = candidates.filter((c) => c.available !== false).slice(0, 2);
  if (top2.length < 2) {
    return [{
      adapterId: candidates[0]?.adapterId ?? 'primary',
      allocationBps: 10_000,
      allocatedAmount: amountIn,
      estimatedOutput: candidates[0]?.estimatedOutput ?? 0n,
    }];
  }

  const splitHalf = amountIn / 2n;
  return [
    {
      adapterId: top2[0]!.adapterId ?? 'rail-1',
      allocationBps: 5000,
      allocatedAmount: splitHalf,
      estimatedOutput: top2[0]!.estimatedOutput / 2n,
    },
    {
      adapterId: top2[1]!.adapterId ?? 'rail-2',
      allocationBps: 5000,
      allocatedAmount: amountIn - splitHalf,
      estimatedOutput: top2[1]!.estimatedOutput / 2n,
    },
  ];
}
