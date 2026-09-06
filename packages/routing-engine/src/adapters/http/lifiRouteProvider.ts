import { encodeFunctionData, type Address } from 'viem';
import type { CandidateRoute, QuoteRequest, RouteHop, TransactionRequest } from '../../types';
import type { RouteProvider } from '../types';
import { executeRoute } from '../../execute';

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

interface LifiAdvancedRoute {
  id?: string;
  fromAmount?: string;
  toAmount?: string;
  toAmountMin?: string;
  gasCostUSD?: string;
  steps?: LifiStep[];
}

interface LifiStep {
  id?: string;
  type?: string;
  tool?: string;
  toolDetails?: { name?: string; key?: string };
  action?: {
    fromChainId?: number;
    toChainId?: number;
    fromAmount?: string;
    fromToken?: { address?: string };
    toToken?: { address?: string };
  };
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
      // The simple /quote endpoint intentionally filters out multi-step routes
      // when the source and destination are different addresses. Advanced
      // routes are required for e.g. Base USDC -> Polygon USDT to a recipient.
      try {
        const advancedInit: RequestInit = {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(options.apiKey ? { 'x-lifi-api-key': options.apiKey } : {}) },
          body: JSON.stringify({
            fromChainId: req.fromChain,
            toChainId: req.toChain,
            fromTokenAddress: req.fromToken,
            toTokenAddress: req.toToken,
            fromAmount: req.fromAmount.toString(),
            fromAddress: req.fromAddress,
            toAddress: req.toAddress,
            options: {
              integrator: options.integrator,
              slippage: (req.slippageBps ?? 50) / 10_000,
            },
          }),
        };
        let advanced: { routes?: LifiAdvancedRoute[] };
        try {
          advanced = await requestJson<{ routes?: LifiAdvancedRoute[] }>(`${baseUrl}/advanced/routes`, advancedInit);
        } catch (error) {
          if (!(error instanceof LifiUnauthorizedError) || !options.apiKey) throw error;
          advancedInit.headers = { 'content-type': 'application/json' };
          advanced = await requestJson<{ routes?: LifiAdvancedRoute[] }>(`${baseUrl}/advanced/routes`, advancedInit);
        }
        const route = advanced.routes?.[0];
        if (route?.steps?.length && route.toAmountMin) {
          return await buildAdvancedCandidate(route, req, baseUrl, id, controller.signal, options.apiKey);
        }
      } catch (error) {
        // Keep the legacy quote path as a compatibility fallback for providers
        // or environments that do not expose advanced routes.
        if (error instanceof Error && error.name === 'AbortError') throw error;
      }

      const endpoint = `${baseUrl}/quote?${params.toString()}`;
      let usedPublicFallback = false;
      let response = await fetch(endpoint, {
        signal: controller.signal,
        headers: options.apiKey ? { 'x-lifi-api-key': options.apiKey } : undefined,
      });
      // LI.FI also exposes public quoting with provider rate limits. A stale
      // key must not make every route disappear, so retry once without it.
      if (response.status === 401 && options.apiKey) {
        usedPublicFallback = true;
        response = await fetch(endpoint, { signal: controller.signal });
      }
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
        riskScore: 0.1,
        available: true,
        providerMetadata: {
          provider: id,
          quoteId: quote.id ?? '',
          tool: quote.tool ?? quote.toolDetails?.name ?? 'unknown',
          ...(usedPublicFallback ? { apiKeyFallback: true } : {}),
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

  return {
    id,
    getCandidateRoutes,
    // LI.FI routes normalize to executable hop transactions; execution
    // delegates to the shared engine executor (PRD §Adapter Interfaces).
    executeRoute: (route, deps) => executeRoute(route, deps),
  };
}

async function buildAdvancedCandidate(
  route: LifiAdvancedRoute,
  req: QuoteRequest,
  baseUrl: string,
  id: string,
  signal: AbortSignal,
  apiKey?: string,
): Promise<CandidateRoute[]> {
  const transactions: TransactionRequest[] = [];
  const hops: RouteHop[] = [];
  let usedPublicFallback = false;

  for (const step of route.steps ?? []) {
    const approvalAddress = step.estimate?.approvalAddress;
    const stepFromToken = step.action?.fromToken?.address ?? req.fromToken;
    const stepFromChain = step.action?.fromChainId ?? req.fromChain;
    const stepToChain = step.action?.toChainId ?? req.toChain;
    const stepAmount = BigInt(step.action?.fromAmount ?? req.fromAmount.toString());
    const actionType = stepFromChain === stepToChain ? 'swap' : 'bridge';
    if (approvalAddress && stepFromToken !== 'native') {
      hops.push({ type: 'approval', chainId: stepFromChain, fromToken: stepFromToken, toToken: stepFromToken, amountIn: stepAmount, amountOut: stepAmount, protocol: id, actionFor: actionType });
      transactions.push({
        to: stepFromToken as Address,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [approvalAddress as Address, stepAmount] }),
        value: 0n,
        chainId: stepFromChain,
        from: req.fromAddress,
      });
    }

    let executable = step;
    if (!step.transactionRequest?.to || !step.transactionRequest.data) {
      const response = await requestJson<LifiStep>(`${baseUrl}/advanced/stepTransaction`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-lifi-api-key': apiKey } : {}) },
        body: JSON.stringify(step),
      }).catch(async (error) => {
        if (error instanceof LifiUnauthorizedError && apiKey) {
          usedPublicFallback = true;
          return requestJson<LifiStep>(`${baseUrl}/advanced/stepTransaction`, {
            method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(step),
          });
        }
        throw error;
      });
      executable = response;
    }
    const tx = executable.transactionRequest;
    if (!tx?.to || !tx.data) throw new Error('LI.FI returned an advanced route without transaction data');
    hops.push({ type: actionType, chainId: stepFromChain, fromChain: stepFromChain, toChain: stepToChain, fromToken: stepFromToken, toToken: step.action?.toToken?.address ?? req.toToken, amountIn: stepAmount, amountOut: BigInt(step.estimate?.toAmountMin ?? step.estimate?.toAmount ?? route.toAmountMin ?? '0'), protocol: `${id}:${step.tool ?? step.toolDetails?.key ?? 'unknown'}` });
    transactions.push({ to: tx.to as Address, data: tx.data as `0x${string}`, value: BigInt(String(tx.value ?? 0)), chainId: tx.chainId ?? stepFromChain, from: (tx.from ?? req.fromAddress) as Address });
  }

  return [{
    route: hops,
    estimatedOutput: BigInt(route.toAmountMin!),
    estimatedTimeSeconds: (route.steps ?? []).reduce((n, s) => n + (s.estimate?.executionDuration ?? 120), 0),
    estimatedFee: (route.steps ?? []).reduce((n, s) => n + sumAmounts(s.estimate?.feeCosts), 0n),
    gasCost: (route.steps ?? []).reduce((n, s) => n + sumAmounts(s.estimate?.gasCosts), 0n),
    reliability: 0.95,
    liquidityScore: 0.9,
    riskScore: 0.1,
    available: true,
    providerMetadata: { provider: id, quoteId: route.id ?? '', routeType: 'advanced', ...(usedPublicFallback ? { apiKeyFallback: true } : {}), statusUrl: `${baseUrl}/status` },
    adapterId: id,
    transactionRequest: transactions[0],
    hopTransactionRequests: transactions,
  }];
}

class LifiUnauthorizedError extends Error {}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) throw new LifiUnauthorizedError('LI.FI API key rejected');
  if (!response.ok) throw new Error(`LI.FI returned ${response.status}`);
  return (await response.json()) as T;
}

function sumAmounts(items: Array<{ amount?: string }> | undefined): bigint {
  return (items ?? []).reduce((total, item) => total + BigInt(item.amount ?? '0'), 0n);
}
