import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { readArtifact } from '@paymesh/contracts';
import { effectiveSlippage, type QuoteRequest, type TransactionRequest } from '../../types';
import type { SwapAdapter, SwapQuote } from '../types';

export interface MockDexAdapterOptions {
  publicClient: PublicClient;
  dexAddress: Address;
  chains?: number[];
}

const DEX_ABI = readArtifact('MockDEX').abi;
const ERC20_APPROVE_ABI = readArtifact('MockERC20').abi;

/**
 * On-chain same-chain swap adapter against the MockDEX constant-product
 * router. Quotes via `getAmountOut` and builds `swap` transactions the sender
 * signs (slippage-protected with `minAmountOut`).
 */
export function createMockDexAdapter(options: MockDexAdapterOptions): SwapAdapter {
  const supportedChains = options.chains ?? [options.publicClient.chain?.id ?? 31337];

  async function quoteSwap(req: {
    chain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<SwapQuote> {
    if (req.tokenIn === req.tokenOut) {
      return { amountOut: req.amountIn, fee: 0n, timeSeconds: 0, reliability: 1 };
    }
    const amountOut = (await options.publicClient.readContract({
      address: options.dexAddress,
      abi: DEX_ABI,
      functionName: 'getAmountOut',
      args: [req.tokenIn as Address, req.tokenOut as Address, req.amountIn],
    })) as bigint;

    if (amountOut === 0n) {
      // Treat a zero quote as no liquidity on this pair.
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 30, reliability: 0 };
    }
    const fee = (req.amountIn * 30n) / 10_000n;
    return { amountOut, fee, timeSeconds: 30, reliability: 1 };
  }

  async function buildSwapTransaction(
    req: QuoteRequest,
    quote: SwapQuote,
  ): Promise<TransactionRequest> {
    const slippage = effectiveSlippage(req);
    const minAmountOut = (quote.amountOut * BigInt(10_000 - slippage)) / 10_000n;
    const data = encodeFunctionData({
      abi: DEX_ABI,
      functionName: 'swap',
      args: [req.fromToken as Address, req.toToken as Address, req.fromAmount, minAmountOut],
    });
    return {
      to: options.dexAddress,
      data,
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (req.fromToken === 'native') {
      throw new Error('Native input does not require an ERC-20 approval');
    }
    return {
      to: req.fromToken as Address,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [options.dexAddress, amount],
      }),
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id: `mock-dex-${options.dexAddress.toLowerCase().slice(0, 10)}`,
    supportedChains,
    quoteSwap,
    buildSwapTransaction,
    buildApprovalTransaction,
  };
}
