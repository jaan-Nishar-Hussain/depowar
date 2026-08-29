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
  /** Source asset the payer holds (token address or 'native'). */
  fromToken?: string;
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