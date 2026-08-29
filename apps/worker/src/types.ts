export type LifecycleEventType =
  | 'quote.ready'
  | 'tx.submitted'
  | 'tx.confirmed'
  | 'deposit.settled'
  | 'deposit.failed';

export interface RouteHopLike {
  type: 'swap' | 'bridge' | 'transfer';
  chainId?: number;
  fromChain?: number;
  toChain?: number;
  fromToken?: string;
  toToken?: string;
  amountIn?: string | bigint;
  amountOut?: string | bigint;
  protocol?: string;
}

export interface TransactionRequestLike {
  to: string;
  data: string;
  value: string;
  chainId?: number;
  from?: string;
}