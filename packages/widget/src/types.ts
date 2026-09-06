import type { QuoteResult } from '@paymesh/sdk';

export interface PayMeshDepositConfig {
  /** Backend base URL, e.g. https://api.paymesh.dev. */
  apiUrl: string;
  /** Integrator API key. */
  apiKey: string;
  /** Recipient the deposit settles to. */
  recipientId: string;
  /** Destination chain id and token the recipient receives. */
  toChain: number;
  toToken: string;
  /** Destination token symbol shown on the completion screen. */
  toTokenSymbol?: string;
  /** Destination token decimals; USDC defaults to 6 when omitted. */
  toTokenDecimals?: number;
  /**
   * Source chains the payer may send from. Defaults to the mainnet set; pass
   * testnet ids (11155111, 84532, 80002) to run against testnets.
   */
  supportedSourceChains?: number[];
  /** Source asset the payer holds (token address or 'native'). */
  fromToken?: string;
  /** Optional per-source-chain token map, useful when testing Sepolia and Base Sepolia together. */
  fromTokenByChain?: Record<number, string>;
  /** Explicit source token choices per chain. Empty/missing addresses are not displayed. */
  supportedTokensByChain?: Record<number, Array<{ symbol: string; address: string; decimals?: number }>>;
  /** Skip the "connect wallet" gate when an account is already available. */
  defaultSlippageBps?: number;
}

export type DepositStatus =
  | 'idle'
  | 'quoting'
  | 'ready'
  | 'signing'
  | 'inFlight'
  | 'settled'
  | 'failed';

/** Minimal API surface the widget needs (implemented by @paymesh/sdk). */
export interface PayMeshDepositApi {
  createDepositIntent(input: {
    recipientId: string;
    toChain: number;
    toToken: string;
  }): Promise<{ depositId: string }>;
  getQuote(query: {
    depositId: string;
    fromChain: number;
    fromToken: string;
    fromAmount: string;
    fromAddress?: string;
    slippageBps?: number;
  }): Promise<QuoteResult>;
  signAndSend(wallet: unknown, tx: { to: string; data: string; value: string }): Promise<string>;
  reportTransaction(quoteId: string, hopIndex: number, txHash: string): Promise<unknown>;
  getStatus(depositId: string): Promise<{ status: string }>;
  pollUntilSettled(
    depositId: string,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<{ status: string }>;
}
