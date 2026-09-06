export type Address = `0x${string}`;

export interface TransactionRequest {
  to: Address;
  data: string;
  value: string;
  chainId?: number;
  from?: Address;
}

export interface RouteHop {
  type: 'approval' | 'swap' | 'bridge' | 'transfer';
  chainId?: number;
  fromChain?: number;
  toChain?: number;
  fromToken?: string;
  toToken?: string;
  amountIn?: string;
  amountOut?: string;
  protocol?: string;
  actionFor?: 'swap' | 'bridge' | 'transfer';
}

export interface QuoteResult {
  quoteId: string;
  depositId: string;
  route: RouteHop[];
  hopTransactionRequests?: TransactionRequest[];
  estimatedOutput: string;
  estimatedTimeSeconds: number;
  estimatedFee: string;
  reliability: number;
  slippageBps: number;
  liquidityScore?: number;
  priceImpactBps?: number;
  gasCost?: string;
  bridgeFee?: string;
  available?: boolean;
  providerMetadata?: Record<string, string | number | boolean>;
  transactionRequest?: TransactionRequest;
  expiresAt: string;
  alternates: Array<{
    adapterId: string;
    estimatedOutput: string;
    estimatedTimeSeconds: number;
  }>;
}

export interface DepositIntentResult {
  depositId: string;
  status: string;
  created: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; userMessage: string; details?: unknown };
  requestId: string;
}

export interface QuoteQuery {
  depositId: string;
  fromChain: number;
  fromToken: string;
  fromAmount: string;
  fromAddress?: Address;
  toAddress?: Address;
  slippageBps?: number;
}

export interface CreateDepositIntentInput {
  recipientId: string;
  toChain: number;
  toToken: string;
  minAmount?: string;
  maxAmount?: string;
  idempotencyKey?: string;
}

export interface RegisterWebhookInput {
  url: string;
  events: string[];
  secret?: string;
}

export interface SettlementUpdateInput {
  chainId: number;
  token: string;
  settlementType?: 'EOA' | 'CONTRACT';
  contractAddress?: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface DepositStatus {
  id: string;
  status: string;
  toChainId: number;
  toToken: string;
  recipient: { walletAddress: string; settlementType: string };
  quotes: unknown[];
  transactions: unknown[];
}

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    userMessage: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(userMessage);
    this.name = 'ApiRequestError';
  }
}

// --- Dashboard / management resource types (PRD §API) ---

export interface Project {
  id: string;
  name: string;
  environment?: string;
  clientId?: string;
  liveClientId?: string;
  createdAt?: string;
  _count?: { apiKeys: number; recipients: number; depositIntents: number };
}

export interface ApiKeyMetadata {
  id: string;
  keyPrefix: string;
  name?: string;
  scopes: string[];
  enabled: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface Recipient {
  id: string;
  walletAddress: string;
  settlementType: string;
  preferredChainId?: number;
  preferredToken?: string;
  kycStatus?: string;
  settlementConfigs?: unknown[];
  createdAt: string;
}

export interface AnalyticsOverview {
  windowDays: number;
  totalDeposits: number;
  settledDeposits: number;
  successRate: number;
  averageSettlementTimeSeconds: number;
  statusCounts: Record<string, number>;
  providerBreakdown: Record<string, number>;
  fallbackQuoteCount: number;
  averageFeePerSettledDeposit: number;
  averageOutputPerSettledDeposit: number;
  recentDeposits: Array<{ id: string; status: string; toChainId: number; toToken: string }>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  quoteId: string;
  depositIntentId: string;
  hopIndex: number;
  chainId: number;
  txHash?: string;
  status: string;
  errorCode?: string;
  submittedAt?: string;
  confirmedAt?: string;
  settledAt?: string;
}
