# Stuck-Fund & Failure Recovery Design (Next-Gen Routing PRD §Execution & Fallback)

## Invariants

1. **Non-custodial by construction.** Every pre-bridge hop is sender-signed;
   if a hop reverts, funds never left the sender. Depowar holds nothing.
2. **Post-burn funds are always recoverable.** CCTP burns are attested by
   Circle: even if the destination `receiveMessage` never executes, the burn
   message remains claimable on the destination MessageTransmitter
   indefinitely. Recovery = re-running the relayer settle for the stored
   `sourceTxHash` (the worker's `recoverPendingSettlements` already re-enqueues
   `SETTLEMENT_PENDING` transactions on every worker start, 120 retries × 30s).
3. **A deposit only becomes FAILED when funds are provably back with the
   sender** (pre-bridge failure with no in-flight burn) **or when all fallback
   routes are exhausted before any burn.**

## Failure matrix

| Failure point | Funds location | Automated handling | Manual path |
|---|---|---|---|
| Swap hop reverts / times out | Sender, source chain | Fallback re-quote (full or mid-route) → new `quote.ready` | Sender keeps funds; intent FAILED after exhaustion |
| Bridge source tx reverts | Sender, source chain | Fallback re-quote excluding failed bridge | Sender keeps funds |
| Bridge burn succeeded, attestation pending | Burned in-flight (Circle) | Monitor retries (BullMQ attempts=120) + `recoverPendingSettlements` on restart | None needed — attestation is permanent |
| Destination `receiveMessage` reverts | Burned in-flight (Circle) | Same as above; relayer re-tries with fresh nonce | Manual `receiveMessage` with stored message+attestation |
| All fallback routes exhausted (pre-burn) | Sender, source chain | `deposit.failed` webhook with `errorCode` | Sender re-initiates; no platform custody |

## Implementation status

- Mid-route fallback (`getFallbackQuoteFromHop`) re-quotes from the confirmed
  intermediate state; completed hops are never double-spent.
- `SETTLEMENT_PENDING` recovery re-registers monitor jobs on worker boot.
- `deposit.failed` events carry the failing `errorCode` and `quoteId` for
  integrator reconciliation.
- The canary tool (`scripts/mainnet-preview.mjs`) simulates before broadcast;
  `--confirm-live` requires `APP_ENV=production` and a 10s abort window.
