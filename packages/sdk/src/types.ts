export type Address = `0x${string}`;

export interface TransactionRequest {
  to: Address;
  data: string;
  value: string;
  chainId?: number;
  from?: Address;
}

export interface RouteHop {
  type: 'swap' | 'bridge' | 'transfer';
  chainId?: number;
  fromChain?: number;
  toChain?: number;
  fromToken?: string;
  toToken?: string;
  amountIn?: string;
  amountOut?: string;
  protocol?: string;
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