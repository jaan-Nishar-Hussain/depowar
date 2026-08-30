import { describe, expect, it } from 'vitest';
import { createUniswapV3Adapter } from '../src/adapters/dex/uniswapV3Adapter';
import type { PublicClient } from 'viem';

const router = '0x1111111111111111111111111111111111111111' as const;
const quoter = '0x2222222222222222222222222222222222222222' as const;
const tokenIn = '0x3333333333333333333333333333333333333333' as const;
const tokenOut = '0x4444444444444444444444444444444444444444' as const;
const user = '0x5555555555555555555555555555555555555555' as const;

describe('Uniswap V3 adapter', () => {
  it('selects the best available fee tier and builds an approval plus swap', async () => {
    const publicClient = {
      simulateContract: async ({ args }: { args: Array<{ fee: number }> }) => ({
        result: args[0]!.fee === 500
          ? [9_950_000n, 0n, 1, 150_000n]
          : [9_900_000n, 0n, 1, 150_000n],
      }),
      getGasPrice: async () => 1n,
    } as unknown as PublicClient;
    const adapter = createUniswapV3Adapter({
      publicClient,
      routerAddress: router,
      quoterAddress: quoter,
      chains: [11155111],
      feeTiers: [500, 3000],
    });
    const request = {
      fromChain: 11155111,
      fromToken: tokenIn,
      fromAmount: 10_000_000n,
      toChain: 11155111,
      toToken: tokenOut,
      fromAddress: user,
      toAddress: user,
    } as const;
    const quote = await adapter.quoteSwap({ chain: 11155111, tokenIn, tokenOut, amountIn: request.fromAmount });
    expect(quote.amountOut).toBe(9_950_000n);
    expect(quote.metadata?.poolFee).toBe(500);

    const approval = await adapter.buildApprovalTransaction!(request, request.fromAmount);
    const swap = await adapter.buildSwapTransaction(request, quote);
    expect(approval.to).toBe(tokenIn);
    expect(swap.to).toBe(router);
    expect(swap.chainId).toBe(11155111);
  });
});

