import { type Address } from 'viem';
import type { QuoteRequest, TransactionRequest } from '../../types';
import type { BridgeAdapter, BridgeQuote } from '../types';

export interface AcrossAdapterOptions {
  /** Across API base. Mainnet only — Across has no public testnet. */
  baseUrl?: string;
  /** Integrator id issued by Across (referral/analytics attribution). */
  integratorId?: string;
  apiKey?: string;
  enabled: boolean;
  /** Chains Across supports as origins (defaults to the major EVM set). */
  fromChains?: number[];
  /** Chains Across supports as destinations (defaults to the major EVM set). */
  toChains?: number[];
  timeoutMs?: number;
  id?: string;
}

interface AcrossQuoteResponse {
  outputAmount?: string;
  expectedFillTime?: number;
  fees?: { total?: string };
  spokePoolAddress?: string;
  error?: string;
}

interface AcrossApprovalResponse {
  to?: string;
  data?: string;
  value?: string | number;
}

/**
 * Across intent-bridge adapter (PRD Tier-1 bridge). Across is mainnet-only:
 * the adapter is inert (`available: false`) unless explicitly enabled, so a
 * misconfigured testnet environment can never produce Across routes.
 */
export function createAcrossAdapter(options: AcrossAdapterOptions): BridgeAdapter {
  const baseUrl = (options.baseUrl ?? 'https://api.across.to').replace(/\/+$/, '');
  const id = options.id ?? 'across';
  // Major chains Across serves (PRD §Priority Provider List). Overridable so
  // operators can tighten the matrix without code changes.
  const fromChains = options.fromChains ?? [1, 8453, 42161, 10, 137, 43114, 56, 59144];
  const toChains = options.toChains ?? fromChains;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) throw new Error(`Across returned ${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  function baseParams(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): URLSearchParams {
    const params = new URLSearchParams({
      inputToken: req.tokenIn,
      outputToken: req.tokenOut,
      originChainId: String(req.fromChain),
      destChainId: String(req.toChain),
      amount: req.amountIn.toString(),
    });
    if (options.integratorId) params.set('integratorId', options.integratorId);
    return params;
  }

  async function quoteBridge(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<BridgeQuote> {
    if (!options.enabled) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn === 'native' || req.tokenOut === 'native') {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    const body = await request<AcrossQuoteResponse>(`/swap/quote?${baseParams(req).toString()}`);
    const amountOut = body.outputAmount ? BigInt(body.outputAmount) : 0n;
    if (amountOut === 0n) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 30, reliability: 0, available: false };
    }
    return {
      amountOut,
      fee: 0n,
      // Across solver fills are typically seconds; keep a conservative floor.
      timeSeconds: Math.max(body.expectedFillTime ?? 15, 15),
      reliability: 0.97,
      liquidityScore: 0.9,
      priceImpactBps: 0,
      available: true,
      metadata: { protocol: 'across', originChain: req.fromChain, destChain: req.toChain },
    };
  }

  async function buildBridgeTransaction(req: QuoteRequest, quote: BridgeQuote): Promise<TransactionRequest> {
    if (!req.fromAddress || !req.toAddress) throw new Error('Across requires sender and recipient addresses');
    const params = baseParams({
      fromChain: req.fromChain,
      toChain: req.toChain,
      tokenIn: req.fromToken,
      tokenOut: req.toToken,
      amountIn: req.fromAmount,
    });
    params.set('depositor', req.fromAddress);
    params.set('recipient', req.toAddress);
    const body = await request<AcrossApprovalResponse>(`/swap/quote?${params.toString()}`);
    if (!body.to || !body.data) throw new Error('Across returned no transaction data');
    return {
      to: body.to as Address,
      data: body.data as `0x${string}`,
      value: BigInt(String(body.value ?? 0)),
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (req.fromToken === 'native') throw new Error('Native input does not require approval');
    if (!req.fromAddress) throw new Error('ERC-20 approval requires a sender address');
    const params = baseParams({
      fromChain: req.fromChain,
      toChain: req.toChain,
      tokenIn: req.fromToken,
      tokenOut: req.toToken,
      amountIn: amount,
    });
    params.set('depositor', req.fromAddress);
    params.set('recipient', req.fromAddress);
    const body = await request<AcrossApprovalResponse>(`/swap/approval?${params.toString()}`);
    if (!body.to || !body.data) throw new Error('Across returned no approval transaction');
    return {
      to: body.to as Address,
      data: body.data as `0x${string}`,
      value: BigInt(String(body.value ?? 0)),
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id,
    supportedFromChains: options.enabled ? fromChains : [],
    supportedToChains: options.enabled ? toChains : [],
    quoteBridge,
    buildBridgeTransaction,
    buildApprovalTransaction,
    healthCheck: async () => {
      if (!options.enabled) return { available: false, reason: 'Across disabled' };
      try {
        const res = await fetch(`${baseUrl}/stats/limits`, { signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) });
        return { available: res.ok, reliability: res.ok ? 0.97 : undefined, reason: res.ok ? undefined : `Across /stats/limits returned ${res.status}` };
      } catch {
        return { available: false, reason: 'Across API unreachable' };
      }
    },
  };
}
