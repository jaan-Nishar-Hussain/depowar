import { createWalletClient, http, type Address, type Chain, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Execution-signer abstraction (Next-Gen Routing PRD §Security: "Wallet
 * Security... private keys must be secured... e.g. Gnosis Safe or HSM").
 *
 * Call sites (the worker's CCTP/mock-bridge relayer, the API's server-custody
 * execution path) depend only on this interface, never on `privateKeyToAccount`
 * directly. Today the only implementation is `createPrivateKeySigner`, which
 * reads a raw hex key from env — acceptable for local/testnet use, but it is
 * the seam a KMS- or HSM-backed signer plugs into for production without
 * touching any caller. A future `createKmsSigner()` (e.g. backed by AWS KMS's
 * asymmetric ECDSA signing, wrapped via viem's `toAccount`) would implement
 * this same interface.
 */
export interface TransactionSigner {
  readonly address: Address;
  /** Builds a viem WalletClient bound to this signer for one chain/RPC. */
  walletClient(chain: Chain, rpcUrl: string): WalletClient;
}

/** Default signer: a raw hex private key held in process memory/env. */
export function createPrivateKeySigner(privateKey: Hex): TransactionSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    walletClient(chain: Chain, rpcUrl: string): WalletClient {
      return createWalletClient({ account, chain, transport: http(rpcUrl) });
    },
  };
}
