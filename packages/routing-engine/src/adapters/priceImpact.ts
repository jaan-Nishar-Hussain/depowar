/**
 * Price-impact estimation shared by the DEX adapters (PRD §Scoring: the
 * `slippage` dimension is scored from `priceImpactBps`, and the validation
 * hard filter rejects routes whose impact exceeds the ceiling).
 *
 * For a constant-product AMM, price impact is monotonic in the swap size, so
 * the marginal rate for a small reference trade can be compared against the
 * full-size rate. This two-point method is a close proxy and needs only one
 * extra quote per pair. It never throws: an environment that cannot provide a
 * marginal quote simply reports zero impact (the on-chain execution still
 * enforces the real slippage bound).
 */
export async function estimatePriceImpactBps(
  quote: (amountIn: bigint) => Promise<bigint>,
  amountIn: bigint,
): Promise<number> {
  if (amountIn <= 0n) return 0;
  const refAmount = amountIn / 1000n; // 0.1% reference trade size
  if (refAmount <= 0n) return 0;
  try {
    const [refOut, fullOut] = await Promise.all([quote(refAmount), quote(amountIn)]);
    if (refOut <= 0n || fullOut <= 0n) return 0;
    const refRate = Number(refOut) / Number(refAmount);
    const fullRate = Number(fullOut) / Number(amountIn);
    if (refRate <= 0) return 0;
    const impact = 1 - fullRate / refRate;
    if (!Number.isFinite(impact) || impact <= 0) return 0;
    return Math.min(10_000, Math.round(impact * 10_000));
  } catch {
    return 0;
  }
}