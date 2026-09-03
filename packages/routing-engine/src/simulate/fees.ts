/**
 * Protocol fee model (PRD §Simulation). Used when a provider does not return
 * explicit fee data, and in tests. Values are indicative bps of `amountIn`:
 * CCTP fast-lane fees are ~1bp, Across charges roughly 5-10bp, standard
 * liquidity bridges and DEX fee tiers sit around 30bp.
 */
export function estimateBridgeFeeBps(protocol: string): number {
  const normalized = protocol.toLowerCase();
  if (normalized.startsWith('cctp')) return 1;
  if (normalized.startsWith('across')) return 6;
  if (normalized.startsWith('stargate')) return 6;
  if (normalized.startsWith('hop')) return 10;
  if (normalized.startsWith('ccip')) return 35;
  return 30;
}

export function estimateBridgeFee(amountIn: bigint, protocol: string): bigint {
  const bps = estimateBridgeFeeBps(protocol);
  return (amountIn * BigInt(bps)) / 10_000n;
}

/** Rough per-chain native-gas estimate in gas units for a hop type. */
export function estimateGasUnits(hopType: 'swap' | 'bridge' | 'transfer' | 'approval'): bigint {
  switch (hopType) {
    case 'swap': return 180_000n;
    case 'bridge': return 120_000n;
    case 'approval': return 46_000n;
    case 'transfer': return 50_000n;
  }
}
