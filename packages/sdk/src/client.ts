import type { WalletClient } from 'viem';
import {
  ApiRequestError,
  type Address,
  type AnalyticsOverview,
  type ApiErrorBody,
  type ApiKeyMetadata,
  type CreateDepositIntentInput,
  type DepositIntentResult,
  type DepositStatus,
  type Project,
  type QuoteQuery,
  type QuoteResult,
  type Recipient,
  type RegisterWebhookInput,
  type SettlementUpdateInput,
  type TransactionRequest,
  type WebhookSubscription,
} from './types';

export interface PayMeshClientConfig {
  baseUrl: string;
  apiKey?: string;
  authToken?: string;
}

/**
 * Headless PayMesh SDK: wraps the REST API. `signAndSend` submits a route hop
 * with any viem WalletClient, then `reportTransaction` tells the backend to
 * monitor it (or use `executeRoute` for the server-custody flow).
 */
export class PayMeshClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly authToken?: string;

  constructor(config: PayMeshClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.authToken = config.authToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : this.apiKey ? { 'x-api-key': this.apiKey } : {}),
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

  /** Dashboard deposit list: paginated + filterable (PRD §API). */
  listDepositIntents(query: {
    status?: string;
    toChainId?: number;
    search?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{
    items: Array<{
      id: string;
      status: string;
      toChainId: number;
      toToken: string;
      recipientWallet?: string;
      fromChainId?: number | null;
      fromToken?: string | null;
      fromAmount?: string | null;
      estimatedOutput?: string | null;
      providerId?: string | null;
      transactionCount: number;
      confirmedTransactions: number;
      createdAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.toChainId) params.set('toChainId', String(query.toChainId));
    if (query.search) params.set('search', query.search);
    if (query.fromDate) params.set('fromDate', query.fromDate);
    if (query.toDate) params.set('toDate', query.toDate);
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request(`/deposit-intents${qs ? `?${qs}` : ''}`);
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

  listWebhooks(): Promise<WebhookSubscription[]> {
    return this.request('/webhooks');
  }

  /** Webhook delivery log (PRD §Monitoring). */
  listWebhookDeliveries(webhookId: string, limit = 50): Promise<{
    items: Array<{
      id: string;
      eventId?: string | null;
      status: string;
      attempts: number;
      responseCode?: number | null;
      lastError?: string | null;
      deliveredAt?: string | null;
      createdAt: string;
    }>;
  }> {
    return this.request(`/webhooks/${encodeURIComponent(webhookId)}/deliveries?limit=${limit}`);
  }

  deleteWebhook(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/webhooks/${id}`, { method: 'DELETE' });
  }

  /**
   * Verifies the HMAC-SHA256 signature the worker attaches to webhook
   * deliveries (`x-paymesh-signature`). Integrators should call this before
   * trusting a payload (PRD §Webhooks & Status). Uses the Web Crypto API so it
   * works in both browsers and Node 18+.
   */
  async verifyWebhookSignature(secret: string, body: string, signature: string): Promise<boolean> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return constantTimeEqualHex(expected, signature);
  }

  listChains(): Promise<Array<{ id: number; name: string; testnet: boolean }>> {
    return this.request('/chains');
  }

  /** Lists the destination chains enabled by the Depowar deployment. */
  listDestinationChains(): Promise<Array<{ id: number; name: string; testnet: boolean }>> {
    return this.request('/destination-chains');
  }

  getProject(): Promise<Project> { return this.request('/project'); }

  updateProject(name: string): Promise<Project> {
    return this.request('/project', { method: 'PUT', body: JSON.stringify({ name }) });
  }

  listApiKeys(): Promise<ApiKeyMetadata[]> { return this.request('/api-keys'); }

  createApiKey(scopes?: string[]): Promise<{ id: string; key: string; scopes: string[]; warning: string }> {
    return this.request('/api-keys', { method: 'POST', body: JSON.stringify(scopes ? { scopes } : {}) });
  }

  revokeApiKey(id: string): Promise<{ revoked: boolean }> {
    return this.request(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listRecipients(): Promise<Recipient[]> { return this.request('/recipients'); }

  createRecipient(input: { walletAddress: Address; chainId: number; token: string }): Promise<Recipient> {
    return this.request('/recipients', { method: 'POST', body: JSON.stringify(input) });
  }

  getAnalytics(days = 30): Promise<AnalyticsOverview> { return this.request(`/analytics/overview?days=${days}`); }

  /** Daily deposit/settlement volume series (dashboard chart). */
  getAnalyticsTimeseries(days = 30): Promise<{ days: number; series: Array<{ day: string; deposits: number; settled: number; failed: number; volume: string; settledVolume: string }> }> {
    return this.request(`/analytics/timeseries?days=${days}`);
  }

  /** Live provider health (dashboard provider strip). */
  getProviderHealth(): Promise<unknown> {
    return this.request('/health/providers');
  }

  listWorkspaces(): Promise<Array<{ id: string; name: string; projects: Array<{ id: string; name: string; clientId?: string; liveClientId?: string }> }>> { return this.request('/workspaces'); }
  createWorkspace(name: string): Promise<{ id: string; name: string }> { return this.request('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }); }
  switchWorkspace(organizationId: string): Promise<{ accessToken: string; user: { id: string; email: string }; clientId: string }> { return this.request('/workspaces/switch', { method: 'POST', body: JSON.stringify({ organizationId }) }); }
  listProjects(): Promise<Array<{ id: string; name: string; environment: string; clientId?: string; liveClientId?: string }>> { return this.request('/projects'); }
  createProject(name: string, receiverAddress: Address, destinationChainId: number, destinationToken: 'USDC' | 'USDT', idempotencyKey?: string): Promise<{ project: { id: string; name: string; environment: string; clientId?: string; liveClientId?: string }; apiKey: { id: string; key: string; scopes: string[]; warning: string } }> { return this.request('/projects', { method: 'POST', headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined, body: JSON.stringify({ name, receiverAddress, destinationChainId, destinationToken }) }); }
  switchProject(projectId: string, environment: 'TEST' | 'LIVE' = 'TEST'): Promise<{ accessToken: string; user: { id: string; email: string }; clientId: string }> { return this.request('/projects/switch', { method: 'POST', body: JSON.stringify({ projectId, environment }) }); }

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

  getQuoteById(quoteId: string): Promise<QuoteResult> {
    return this.request<QuoteResult>(`/quotes/${encodeURIComponent(quoteId)}`);
  }

  getTransaction(transactionId: string): Promise<import('./types').TransactionRecord> {
    return this.request(`/transactions/${encodeURIComponent(transactionId)}`);
  }

  listTransactions(intentId: string): Promise<import('./types').TransactionRecord[]> {
    return this.request(`/transactions?intentId=${encodeURIComponent(intentId)}`);
  }

  getRecoveryStatus(depositId: string): Promise<{
    depositId: string;
    status: string;
    fundsLocation: string;
    canRetry: boolean;
    completedHops: number;
    totalHops: number;
    refundable: boolean;
    instructions: string;
  }> {
    return this.request(`/deposit-intents/${encodeURIComponent(depositId)}/recovery`);
  }

  retryDepositIntent(depositId: string): Promise<{ depositId: string; status: string; message: string }> {
    return this.request(`/deposit-intents/${encodeURIComponent(depositId)}/retry`, { method: 'POST' });
  }
}

/** Constant-time hex comparison (PRD §Security: "compared using constant-time check"). */
function constantTimeEqualHex(a: string, b: string): boolean {
  const left = a.length % 2 === 0 ? a : `0${a}`;
  const right = b.length % 2 === 0 ? b : `0${b}`;
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
