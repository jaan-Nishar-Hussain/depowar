import { encodeFunctionData, type Address } from 'viem';
import { effectiveSlippage, type QuoteRequest, type TransactionRequest } from '../../types';
import type { SwapAdapter, SwapQuote } from '../types';

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface OneInchAdapterOptions {
  /** 1inch Aggregator API base, e.g. https://api.1inch.dev */
  baseUrl?: string;
  apiKey?: string;
  /** Chains the aggregator should quote on (validated per request). */
  chains: number[];
  /** Standard approval target for 1inch v6 (the router). */
  routerAddress: Address;
  timeoutMs?: number;
  id?: string;
}

interface OneInchQuoteResponse {
  dstAmount?: string;
  error?: string;
  description?: string;
}

interface OneInchSwapResponse {
  dstAmount?: string;
  tx?: {
    to?: string;
    data?: string;
    value?: string | number;
    from?: string;
    gas?: number;
  };
  error?: string;
  description?: string;
}

/**
 * 1inch Aggregator API v6 swap adapter (PRD Tier-2 DEX provider). Quotes via
 * `/swap/v6.0/{chain}/quote` and builds the transaction via `/swap`; the
 * returned calldata is signed by the sender, so no off-chain trust is added.
 */
export function createOneInchAdapter(options: OneInchAdapterOptions): SwapAdapter {
  const baseUrl = (options.baseUrl ?? 'https://api.1inch.dev').replace(/\/+$/, '');
  const id = options.id ?? '1inch';

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`1inch returned ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function quoteSwap(req: {
    chain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<SwapQuote> {
    if (!options.chains.includes(req.chain)) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn === 'native' || req.tokenOut === 'native') {
      // 1inch v6 supports natives, but this MVP adapter matches the engine's
      // ERC-20 scope; the V2 adapter covers native legs.
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn.toLowerCase() === req.tokenOut.toLowerCase()) {
      return { amountOut: req.amountIn, fee: 0n, timeSeconds: 15, reliability: 0.999, liquidityScore: 1, priceImpactBps: 0, available: true };
    }
    const params = new URLSearchParams({
      src: req.tokenIn,
      dst: req.tokenOut,
      amount: req.amountIn.toString(),
    });
    const body = await request<OneInchQuoteResponse>(`/swap/v6.0/${req.chain}/quote?${params.toString()}`);
    const amountOut = body.dstAmount ? BigInt(body.dstAmount) : 0n;
    if (amountOut === 0n) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 30, reliability: 0, available: false };
    }
    return {
      amountOut,
      fee: 0n,
      timeSeconds: 30,
      reliability: 0.98,
      liquidityScore: 0.9,
      priceImpactBps: 0,
      available: true,
      metadata: { protocol: '1inch-aggregator', chain: req.chain },
    };
  }

  async function buildSwapTransaction(req: QuoteRequest, quote: SwapQuote): Promise<TransactionRequest> {
    if (!req.fromAddress) throw new Error('A sender address is required for a 1inch swap');
    const slippage = effectiveSlippage(req);
    const params = new URLSearchParams({
      src: req.fromToken,
      dst: req.toToken,
      amount: req.fromAmount.toString(),
      from: req.fromAddress,
      origin: req.fromAddress,
      slippage: String(slippage / 10_000),
      disableEstimate: 'true',
    });
    const body = await request<OneInchSwapResponse>(`/swap/v6.0/${req.fromChain}/swap?${params.toString()}`);
    const tx = body.tx;
    if (!tx?.to || !tx.data) throw new Error('1inch returned no transaction data');
    return {
      to: tx.to as Address,
      data: tx.data as `0x${string}`,
      value: BigInt(String(tx.value ?? 0)),
      chainId: req.fromChain,
      from: (tx.from ?? req.fromAddress) as Address,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (req.fromToken === 'native') throw new Error('Native input does not require approval');
    if (!req.fromAddress) throw new Error('ERC-20 approval requires a sender address');
    return {
      to: req.fromToken as Address,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [options.routerAddress, amount],
      }),
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id,
    supportedChains: options.chains,
    quoteSwap,
    buildSwapTransaction,
    buildApprovalTransaction,
  };
}
