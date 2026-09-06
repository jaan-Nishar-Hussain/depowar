import { type Chain } from 'viem';
import type { CandidateRoute, TransactionRequest } from './types';
import type { TransactionSigner } from './signer';

/**
 * Execution seam (Next-Gen Routing PRD §Adapter Interfaces: the `RouteProvider`
 * contract exposes `getQuote` + `executeRoute`).
 *
 * Every provider — whether it is an on-chain adapter, an HTTP aggregator, or a
 * graph-composed path — normalizes into a `CandidateRoute` carrying one
 * index-aligned `hopTransactionRequests` per hop. Execution therefore lives in
 * one place: this executor submits (or simulates) those hop transactions in
 * order and reports a normalized result. The API's server-custody path and the
 * worker's relayer both depend on it; individual `executeRoute` methods on
 * providers delegate here so no provider re-implements broadcasting.
 */
export interface ExecutionResult {
  /** `submitted`: hops were signed and broadcast. `simulated`: eth_call only. `unsupported`: no executable hops or no signer configured. */
  status: 'submitted' | 'simulated' | 'unsupported';
  /** One tx hash per submitted hop (empty for simulated/unsupported). */
  txHashes: string[];
  /** Error message when a hop submission or simulation failed. */
  error?: string;
}

export interface ExecuteRouteDeps {
  /** Signer used to broadcast hop transactions. Absent => simulation only. */
  signer?: TransactionSigner;
  /** chainId -> RPC URL, used to create the wallet/public client per hop. */
  rpcUrls: Record<number, string>;
  /** When true, `eth_call`-simulate each hop instead of broadcasting. */
  simulateOnly?: boolean;
  /** Stateless simulation callback (used when `simulateOnly`). */
  simulateTx?: (tx: TransactionRequest) => Promise<unknown>;
}

/**
 * Executes (or simulates) every hop of a candidate route in order. Funds stay
 * non-custodial: each hop is signed by the configured signer and broadcast to
 * the hop's chain; nothing is ever held by this module.
 */
export async function executeRoute(
  route: CandidateRoute,
  deps: ExecuteRouteDeps,
): Promise<ExecutionResult> {
  const txs = route.hopTransactionRequests ?? (route.transactionRequest ? [route.transactionRequest] : []);
  if (txs.length === 0) {
    return { status: 'unsupported', txHashes: [] };
  }

  if (deps.simulateOnly || !deps.signer) {
    if (!deps.simulateTx) {
      return { status: 'unsupported', txHashes: [], error: 'no signer or simulation callback configured' };
    }
    for (const tx of txs) {
      try {
        await deps.simulateTx(tx);
      } catch (error) {
        return { status: 'simulated', txHashes: [], error: (error as Error).message ?? 'hop simulation reverted' };
      }
    }
    return { status: 'simulated', txHashes: [] };
  }

  const txHashes: string[] = [];
  for (const tx of txs) {
    const chainId = tx.chainId ?? route.route[0]?.chainId ?? route.route[0]?.fromChain;
    if (!chainId) return { status: 'unsupported', txHashes, error: 'hop has no chain id' };
    const rpcUrl = deps.rpcUrls[chainId];
    if (!rpcUrl) return { status: 'unsupported', txHashes, error: `no RPC configured for chain ${chainId}` };
    const chain: Chain = {
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
    try {
      const hash = await deps.signer.walletClient(chain, rpcUrl).sendTransaction({
        account: deps.signer.address,
        chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
      txHashes.push(hash);
    } catch (error) {
      return { status: 'unsupported', txHashes, error: (error as Error).message ?? `hop submission failed on chain ${chainId}` };
    }
  }
  return { status: 'submitted', txHashes };
}