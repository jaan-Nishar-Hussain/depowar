import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { effectiveSlippage, type QuoteRequest, type TransactionRequest } from '../../types';
import type { SwapAdapter, SwapQuote } from '../types';
import { estimatePriceImpactBps } from '../priceImpact';

const V2_ROUTER_ABI = [
  {
    type: 'function', name: 'getAmountsOut', stateMutability: 'view',
    inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'swapExactTokensForTokens', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ], outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'swapExactETHForTokens', stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ], outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'swapExactTokensForETH', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ], outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const ERC20_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface V2DexAdapterOptions {
  publicClient: PublicClient;
  routerAddress: Address;
  wrappedNative: Address;
  chains: number[];
  id?: string;
  deadlineSeconds?: number;
}

/**
 * Adapter for any Uniswap-V2-compatible router. It is deliberately limited to
 * a single-hop path: the route handler can compare several adapters and an
 * HTTP aggregator can provide multi-hop candidates independently.
 */
export function createV2DexAdapter(options: V2DexAdapterOptions): SwapAdapter {
  const deadlineSeconds = options.deadlineSeconds ?? 120;
  const pathFor = (tokenIn: string, tokenOut: string): Address[] => [
    (tokenIn === 'native' ? options.wrappedNative : tokenIn) as Address,
    (tokenOut === 'native' ? options.wrappedNative : tokenOut) as Address,
  ];

  async function quoteSwap(req: { chain: number; tokenIn: string; tokenOut: string; amountIn: bigint }): Promise<SwapQuote> {
    if (req.tokenIn === req.tokenOut) {
      return { amountOut: req.amountIn, fee: 0n, timeSeconds: 15, reliability: 0.99, liquidityScore: 1, priceImpactBps: 0 };
    }
    const amounts = await options.publicClient.readContract({
      address: options.routerAddress,
      abi: V2_ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [req.amountIn, pathFor(req.tokenIn, req.tokenOut)],
    });
    const amountOut = amounts[amounts.length - 1] ?? 0n;
    if (amountOut === 0n) return { amountOut: 0n, fee: req.amountIn, timeSeconds: 30, reliability: 0 };
    const path = pathFor(req.tokenIn, req.tokenOut);
    const impactBps = await estimatePriceImpactBps(async (amount: bigint) => {
      const small = await options.publicClient.readContract({
        address: options.routerAddress,
        abi: V2_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amount, path],
      });
      return small[small.length - 1] ?? 0n;
    }, req.amountIn);
    return {
      amountOut,
      fee: 0n,
      timeSeconds: 30,
      reliability: 0.99,
      liquidityScore: 0.9,
      priceImpactBps: impactBps,
      riskScore: 0.05,
    };
  }

  async function buildSwapTransaction(req: QuoteRequest, quote: SwapQuote): Promise<TransactionRequest> {
    if (!req.fromAddress) throw new Error('A sender address is required for a swap route');
    const minAmountOut = (quote.amountOut * BigInt(10_000 - effectiveSlippage(req))) / 10_000n;
    const path = pathFor(req.fromToken, req.toToken);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    let functionName: 'swapExactTokensForTokens' | 'swapExactETHForTokens' | 'swapExactTokensForETH';
    let args: readonly unknown[];
    let value = 0n;
    if (req.fromToken === 'native') {
      functionName = 'swapExactETHForTokens';
      args = [minAmountOut, path, req.fromAddress as Address, deadline];
      value = req.fromAmount;
    } else if (req.toToken === 'native') {
      functionName = 'swapExactTokensForETH';
      args = [req.fromAmount, minAmountOut, path, req.fromAddress as Address, deadline];
    } else {
      functionName = 'swapExactTokensForTokens';
      args = [req.fromAmount, minAmountOut, path, req.fromAddress as Address, deadline];
    }
    return {
      to: options.routerAddress,
      data: encodeFunctionData({ abi: V2_ROUTER_ABI, functionName, args: args as never }),
      value,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (req.fromToken === 'native') throw new Error('Native input does not require approval');
    return {
      to: req.fromToken as Address,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [options.routerAddress, amount] }),
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id: options.id ?? `v2-dex-${options.routerAddress.toLowerCase().slice(0, 10)}`,
    supportedChains: options.chains,
    quoteSwap,
    buildSwapTransaction,
    buildApprovalTransaction,
  };
}
