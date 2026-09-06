import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { effectiveSlippage, type QuoteRequest, type TransactionRequest } from '../../types';
import type { SwapAdapter, SwapQuote } from '../types';
import { estimatePriceImpactBps } from '../priceImpact';

const QUOTER_V2_ABI = [{
  type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
  inputs: [{
    name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
  }],
  outputs: [
    { name: 'amountOut', type: 'uint256' },
    { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' },
    { name: 'gasEstimate', type: 'uint256' },
  ],
}] as const;

const SWAP_ROUTER_ABI = [{
  type: 'function', name: 'exactInputSingle', stateMutability: 'nonpayable',
  inputs: [{
    name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
  }],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}] as const;

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface UniswapV3AdapterOptions {
  publicClient: PublicClient;
  routerAddress: Address;
  quoterAddress: Address;
  chains: number[];
  feeTiers?: number[];
  deadlineSeconds?: number;
  id?: string;
}

/**
 * Uniswap V3 single-hop adapter. It deliberately quotes multiple fee tiers
 * and chooses the best live quote, while leaving multi-hop path search to the
 * route handler/provider layer.
 */
export function createUniswapV3Adapter(options: UniswapV3AdapterOptions): SwapAdapter {
  const feeTiers = options.feeTiers ?? [500, 3000, 10000];
  const deadlineSeconds = options.deadlineSeconds ?? 120;

  async function quoteSwap(req: { chain: number; tokenIn: string; tokenOut: string; amountIn: bigint }): Promise<SwapQuote> {
    if (req.tokenIn === 'native' || req.tokenOut === 'native') {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn.toLowerCase() === req.tokenOut.toLowerCase()) {
      return { amountOut: req.amountIn, fee: 0n, timeSeconds: 15, reliability: 0.999, liquidityScore: 1, priceImpactBps: 0, available: true };
    }

    const quotes: Array<{ amountOut: bigint; gasEstimate: bigint; feeTier: number }> = [];
    for (const feeTier of feeTiers) {
      try {
        const result = await options.publicClient.simulateContract({
          address: options.quoterAddress,
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: req.tokenIn as Address,
            tokenOut: req.tokenOut as Address,
            amountIn: req.amountIn,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
          }],
        });
        const [amountOut, , , gasEstimate] = result.result as readonly [bigint, bigint, number, bigint];
        if (amountOut > 0n) quotes.push({ amountOut, gasEstimate, feeTier });
      } catch {
        // A missing pool or empty testnet pool reverts the quoter call.
      }
    }
    const best = quotes.sort((a, b) => a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0)[0];
    if (!best) return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };

    let gasCost: bigint | undefined;
    try {
      gasCost = best.gasEstimate * await options.publicClient.getGasPrice();
    } catch {
      // Gas is optional for quoting; route scoring still uses output/slippage.
    }
    // Price impact for the winning fee tier: compare the marginal (0.1% size)
    // rate with the full-size rate from the quoter.
    const impactBps = await estimatePriceImpactBps(async (amount: bigint) => {
      const result = await options.publicClient.simulateContract({
        address: options.quoterAddress,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: req.tokenIn as Address,
          tokenOut: req.tokenOut as Address,
          amountIn: amount,
          fee: best.feeTier,
          sqrtPriceLimitX96: 0n,
        }],
      });
      return (result.result as readonly [bigint, bigint, number, bigint])[0];
    }, req.amountIn);

    return {
      amountOut: best.amountOut,
      fee: 0n,
      timeSeconds: 30,
      reliability: 0.995,
      liquidityScore: 0.9,
      priceImpactBps: impactBps,
      riskScore: 0.02,
      gasCost,
      available: true,
      metadata: { poolFee: best.feeTier, protocol: 'uniswap-v3' },
    };
  }

  async function buildSwapTransaction(req: QuoteRequest, quote: SwapQuote): Promise<TransactionRequest> {
    if (!req.fromAddress) throw new Error('A sender address is required for a Uniswap V3 swap');
    if (req.fromToken === 'native' || req.toToken === 'native') {
      throw new Error('The Uniswap V3 MVP adapter supports ERC-20 to ERC-20 swaps only');
    }
    const poolFee = Number(quote.metadata?.poolFee ?? feeTiers[0]);
    const minimum = (quote.amountOut * BigInt(10_000 - effectiveSlippage(req))) / 10_000n;
    const data = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: req.fromToken as Address,
        tokenOut: req.toToken as Address,
        fee: poolFee,
        recipient: req.fromAddress,
        deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds),
        amountIn: req.fromAmount,
        amountOutMinimum: minimum,
        sqrtPriceLimitX96: 0n,
      }],
    });
    return { to: options.routerAddress, data, value: 0n, chainId: req.fromChain, from: req.fromAddress };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (!req.fromAddress || req.fromToken === 'native') throw new Error('ERC-20 approval requires a sender and token');
    return {
      to: req.fromToken as Address,
      data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [options.routerAddress, amount] }),
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id: options.id ?? `uniswap-v3-${options.routerAddress.toLowerCase().slice(0, 10)}`,
    supportedChains: options.chains,
    quoteSwap,
    buildSwapTransaction,
    buildApprovalTransaction,
  };
}

