import { encodeFunctionData, type Address } from 'viem';
import type { CandidateRoute, QuoteRequest, RouteHop, TransactionRequest } from '../../types';
import type { RouteProvider } from '../types';

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

interface LifiQuote {
  id?: string;
  type?: string;
  tool?: string;
  toolDetails?: { name?: string; key?: string };
  action?: { fromChainId?: number; toChainId?: number; fromToken?: { address?: string }; toToken?: { address?: string } };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    executionDuration?: number;
    priceImpact?: number | string;
    gasCosts?: Array<{ amount?: string }>;
    feeCosts?: Array<{ amount?: string }>;
    approvalAddress?: string;
  };
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string | number;
    chainId?: number;
    from?: string;
  };
}

export interface LifiRouteProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  integrator?: string;
  timeoutMs?: number;
  id?: string;
}

/**
 * Concrete LI.FI quote adapter. LI.FI is optional; it is not embedded into
 * the routing policy and can be ranked against any other configured provider.
 */
export function createLifiRouteProvider(options: LifiRouteProviderOptions = {}): RouteProvider {
  const baseUrl = (options.baseUrl ?? 'https://li.quest/v1').replace(/\/+$/, '');
  const id = options.id ?? 'lifi';

  async function getCandidateRoutes(req: QuoteRequest): Promise<CandidateRoute[]> {
    if (!req.fromAddress || !req.toAddress) throw new Error('LI.FI quotes require sender and recipient addresses');
    const params = new URLSearchParams({
      fromChain: String(req.fromChain),
      toChain: String(req.toChain),
      fromToken: req.fromToken,
      toToken: req.toToken,
      fromAmount: req.fromAmount.toString(),
      fromAddress: req.fromAddress,
      toAddress: req.toAddress,
      slippage: String((req.slippageBps ?? 50) / 10_000),
      ...(options.integrator ? { integrator: options.integrator } : {}),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
    try {
      const response = await fetch(`${baseUrl}/quote?${params.toString()}`, {
        signal: controller.signal,
        headers: options.apiKey ? { 'x-lifi-api-key': options.apiKey } : undefined,
      });
      if (!response.ok) throw new Error(`LI.FI returned ${response.status}`);
      const quote = (await response.json()) as LifiQuote;
      const actionTx = quote.transactionRequest;
      const output = quote.estimate?.toAmountMin ?? quote.estimate?.toAmount;
      if (!output || !actionTx?.to || !actionTx.data) throw new Error('LI.FI returned no executable quote');

      const actionType = req.fromChain === req.toChain ? 'swap' : 'bridge';
      const route: RouteHop[] = [];
      const transactions: TransactionRequest[] = [];
      const approvalAddress = quote.estimate?.approvalAddress;
      if (approvalAddress && req.fromToken !== 'native') {
        route.push({
          type: 'approval', chainId: req.fromChain, fromToken: req.fromToken,
          toToken: req.fromToken, amountIn: req.fromAmount, amountOut: req.fromAmount,
          protocol: id, actionFor: actionType,
        });
        transactions.push({
          to: req.fromToken as Address,
          data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [approvalAddress as Address, req.fromAmount] }),
          value: 0n,
          chainId: req.fromChain,
          from: req.fromAddress,
        });
      }
      route.push({
        type: actionType,
        chainId: req.fromChain,
        fromChain: req.fromChain,
        toChain: req.toChain,
        fromToken: req.fromToken,
        toToken: req.toToken,
        amountIn: req.fromAmount,
        amountOut: BigInt(output),
        protocol: `${id}:${quote.tool ?? quote.toolDetails?.key ?? 'unknown'}`,
      });
      transactions.push({
        to: actionTx.to as Address,
        data: actionTx.data as `0x${string}`,
        value: BigInt(String(actionTx.value ?? 0)),
        chainId: actionTx.chainId ?? req.fromChain,
        from: (actionTx.from ?? req.fromAddress) as Address,
      });

      const gasCost = sumAmounts(quote.estimate?.gasCosts);
      const fee = sumAmounts(quote.estimate?.feeCosts);
      const impact = Number(quote.estimate?.priceImpact ?? 0);
      return [{
        route,
        estimatedOutput: BigInt(output),
        estimatedTimeSeconds: quote.estimate?.executionDuration ?? 120,
        estimatedFee: fee,
        gasCost,
        reliability: 0.95,
        liquidityScore: 0.9,
        priceImpactBps: Number.isFinite(impact) ? (impact < 1 ? impact * 10_000 : impact) : undefined,
        available: true,
        providerMetadata: {
          provider: id,
          quoteId: quote.id ?? '',
          tool: quote.tool ?? quote.toolDetails?.name ?? 'unknown',
          statusUrl: `${baseUrl}/status`,
        },
        adapterId: id,
        transactionRequest: transactions[0],
        hopTransactionRequests: transactions,
      }];
    } finally {
      clearTimeout(timer);
    }
  }

  return { id, getCandidateRoutes };
}

function sumAmounts(items: Array<{ amount?: string }> | undefined): bigint {
  return (items ?? []).reduce((total, item) => total + BigInt(item.amount ?? '0'), 0n);
}
