import { effectiveSlippage, type CandidateRoute, type QuoteRequest, type RouteHop } from '../types';

export interface ValidationOptions {
  /**
   * Output floor as basis points of input (e.g. 9900 = route must produce at
   * least 99% of input). PRD's hard filter for stablecoin legs. When omitted,
   * the effective slippage tolerance of the request is used as the floor.
   */
  minOutputRatioBps?: number;
  /** Reject routes whose declared price impact exceeds this ceiling. */
  maxPriceImpactBps?: number;
}

export interface RouteValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Hard filters applied before a candidate is ranked (PRD §Simulation). These
 * are cheap structural checks; on-chain call simulation is the caller's
 * optional extra step via `simulateFirstTransaction`.
 */
export function validateCandidate(
  candidate: CandidateRoute,
  req: QuoteRequest,
  options: ValidationOptions = {},
): RouteValidationResult {
  const reasons: string[] = [];
  if (candidate.available === false) {
    reasons.push('candidate reported unavailable');
  }
  if (candidate.estimatedOutput <= 0n) {
    reasons.push('estimated output is zero or negative');
  }

  const floorBps = options.minOutputRatioBps ?? 10_000 - effectiveSlippage(req);
  if (floorBps > 0 && floorBps < 10_000) {
    const floor = (req.fromAmount * BigInt(floorBps)) / 10_000n;
    if (candidate.estimatedOutput < floor) {
      reasons.push(`output below floor: ${candidate.estimatedOutput} < ${floor}`);
    }
  }

  const impactCeiling = options.maxPriceImpactBps ?? effectiveSlippage(req) * 2;
  const impact = candidate.priceImpactBps ?? 0;
  if (impact > impactCeiling) {
    reasons.push(`price impact ${impact}bps exceeds ceiling ${impactCeiling}bps`);
  }

  const hopIssues = validateHopContinuity(candidate.route, req);
  reasons.push(...hopIssues);

  return { valid: reasons.length === 0, reasons };
}

/**
 * Verifies that consecutive hops connect: a non-bridge hop must stay on one
 * chain and hand the previous hop's output to the next hop's input.
 */
export function validateHopContinuity(route: RouteHop[], req: QuoteRequest): string[] {
  const reasons: string[] = [];
  if (route.length === 0) return reasons;

  let expectedAmount = req.fromAmount;
  let expectedToken = req.fromToken;
  let expectedChain = req.fromChain;

  for (let i = 0; i < route.length; i++) {
    const hop = route[i]!;
    if (hop.type === 'approval') {
      if (!sameChain(hop.chainId, expectedChain)) reasons.push(`approval hop ${i} is on an unexpected chain`);
      if (hop.fromToken !== undefined && !sameAddressToken(hop.fromToken, expectedToken)) {
        reasons.push(`approval hop ${i} approves an unexpected token`);
      }
      continue;
    }
    if (hop.type === 'bridge') {
      if (!sameChain(hop.fromChain ?? hop.chainId, expectedChain)) {
        reasons.push(`bridge hop ${i} starts on an unexpected chain`);
      }
      if (hop.amountIn !== undefined && hop.amountIn !== expectedAmount) {
        reasons.push(`bridge hop ${i} input does not match previous output`);
      }
      expectedAmount = hop.amountOut ?? expectedAmount;
      expectedChain = hop.toChain ?? req.toChain;
      expectedToken = hop.toToken ?? expectedToken;
      continue;
    }
    // swap / transfer
    if (hop.amountIn !== undefined && hop.amountIn !== expectedAmount) {
      reasons.push(`hop ${i} input does not match previous output`);
    }
    // A swap legitimately changes the token; a transfer must not.
    if (hop.type === 'transfer' && hop.toToken !== undefined && !sameAddressToken(hop.toToken, expectedToken)) {
      reasons.push(`transfer hop ${i} changes the token`);
    }
    if (!sameChain(hop.chainId, expectedChain)) {
      reasons.push(`hop ${i} is on an unexpected chain`);
    }
    expectedAmount = hop.amountOut ?? expectedAmount;
    expectedToken = hop.toToken ?? expectedToken;
  }
  return reasons;
}

function sameChain(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return true; // undeclared chains pass structural checks
  return a === b;
}

function sameAddressToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === 'native' || b === 'native') return false;
  return a.toLowerCase() === b.toLowerCase();
}

export interface FirstTransactionSimulation {
  ok: boolean;
  reason?: string;
}

/**
 * Stateless on-chain simulation of the first signable transaction
 * (`eth_call`). Catches reverts before a quote is returned. Never throws: a
 * simulation-capable environment is optional and a failing RPC is reported,
 * not propagated.
 */
export async function simulateFirstTransaction(
  candidate: CandidateRoute,
  call: (tx: NonNullable<CandidateRoute['transactionRequest']>) => Promise<unknown>,
): Promise<FirstTransactionSimulation> {
  const tx = candidate.transactionRequest;
  if (!tx) return { ok: false, reason: 'candidate has no executable transaction' };
  try {
    await call(tx);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error).message ?? 'eth_call reverted' };
  }
}
