import type { WalletClient } from 'viem';
import {
  ApiRequestError,
  type Address,
  type ApiErrorBody,
  type CreateDepositIntentInput,
  type DepositIntentResult,
  type DepositStatus,
  type QuoteQuery,
  type QuoteResult,
  type RegisterWebhookInput,
  type SettlementUpdateInput,
  type TransactionRequest,
} from './types';

export interface PayMeshClientConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Headless PayMesh SDK: wraps the REST API. `signAndSend` submits a route hop
 * with any viem WalletClient, then `reportTransaction` tells the backend to
 * monitor it (or use `executeRoute` for the server-custody flow).
 */
export class PayMeshClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: PayMeshClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        ...(init?.headers ?? {}),
      },
    });

    const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
    if (!response.ok) {
      const error = (body as ApiErrorBody | null)?.error;
      throw new ApiRequestError(
        error?.code ?? 'HTTP_ERROR',
        error?.userMessage ?? `Request failed with status ${response.status}`,
        response.status,
        body,
      );
    }
    return body as T;
  }

  createDepositIntent(input: CreateDepositIntentInput): Promise<DepositIntentResult> {
    return this.request('/deposit-intents', { method: 'POST', body: JSON.stringify(input) });
  }

  getQuote(query: QuoteQuery): Promise<QuoteResult> {
    const params = new URLSearchParams({
      depositId: query.depositId,
      fromChain: String(query.fromChain),
      fromToken: query.fromToken,
      fromAmount: query.fromAmount,
    });
    if (query.fromAddress) params.set('fromAddress', query.fromAddress);
    if (query.toAddress) params.set('toAddress', query.toAddress);
    if (query.slippageBps !== undefined) params.set('slippageBps', String(query.slippageBps));
    return this.request<QuoteResult>(`/quote?${params.toString()}`);
  }

  executeRoute(quoteId: string): Promise<{ quoteId: string; txHash: string }> {
    return this.request(`/quote/${quoteId}/execute`, { method: 'POST' });
  }

  reportTransaction(quoteId: string, hopIndex: number, txHash: string): Promise<{ transactionId: string; status: string }> {
    return this.request(`/quote/${quoteId}/transactions`, {
      method: 'POST',
      body: JSON.stringify({ hopIndex, txHash }),
    });
  }

  getStatus(depositId: string): Promise<DepositStatus> {
    return this.request(`/status?depositId=${encodeURIComponent(depositId)}`);
  }

  registerWebhook(input: RegisterWebhookInput): Promise<{ id: string; url: string; events: string[]; secret: string }> {
    return this.request('/webhooks', { method: 'POST', body: JSON.stringify(input) });
  }

  listWebhooks(): Promise<unknown[]> {
    return this.request('/webhooks');
  }

  deleteWebhook(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/webhooks/${id}`, { method: 'DELETE' });
  }

  listChains(): Promise<Array<{ id: number; name: string; testnet: boolean }>> {
    return this.request('/chains');
  }

  /** Lists the destination chains enabled by the Depowar deployment. */
  listDestinationChains(): Promise<Array<{ id: number; name: string; testnet: boolean }>> {
    return this.request('/destination-chains');
  }

  listTokens(chainId: number): Promise<Array<{ symbol: string; name: string; decimals: number; native?: boolean }>> {
    return this.request(`/tokens?chainId=${chainId}`);
  }

  updateSettlement(recipientId: string, input: SettlementUpdateInput): Promise<unknown> {
    return this.request(`/recipients/${recipientId}/settlement`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  /**
   * Signs and broadcasts a single route hop with the caller's wallet client.
   * Returns the tx hash (cast to a checksummed-friendly string via lowercase).
   */
  async signAndSend(walletClient: WalletClient, tx: TransactionRequest): Promise<Address> {
    if (!walletClient.account?.address) {
      throw new Error('Wallet must have an active account before signing');
    }
    const hash = await walletClient.sendTransaction({
      account: walletClient.account,
      to: tx.to,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value),
      chain: undefined,
    });
    return hash;
  }

  /** Polls the status endpoint until the deposit settles or the timeout hits. */
  async pollUntilSettled(
    depositId: string,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<DepositStatus> {
    const intervalMs = opts.intervalMs ?? 1_500;
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const start = Date.now();
    for (;;) {
      const status = await this.getStatus(depositId);
      if (status.status === 'SETTLED' || status.status === 'FAILED') return status;
      if (Date.now() - start > timeoutMs) throw new Error(`Deposit ${depositId} did not settle in time`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
