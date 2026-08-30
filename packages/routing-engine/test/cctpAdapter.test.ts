import { describe, expect, it } from 'vitest';
import { createCctpAdapter } from '../src/adapters/bridge/cctpAdapter';
import { getQuote } from '../src/getQuote';
import type { PublicClient } from 'viem';

const SOURCE_USDC = '0x1111111111111111111111111111111111111111' as const;
const DEST_USDC = '0x2222222222222222222222222222222222222222' as const;
const USER = '0x3333333333333333333333333333333333333333' as const;
const MESSENGER = '0x4444444444444444444444444444444444444444' as const;

const publicClient = {
  readContract: async () => 0n,
} as unknown as PublicClient;

const cctp = createCctpAdapter({
  publicClient,
  tokenMessenger: MESSENGER,
  sourceUsdc: SOURCE_USDC,
  destinationUsdc: DEST_USDC,
  sourceChainId: 11155111,
  destinationChainId: 80002,
  destinationDomain: 7,
});

describe('CCTP adapter', () => {
  it('maps destination USDC to source-chain native USDC', () => {
    expect(cctp.sourceTokenFor?.({ fromChain: 11155111, toChain: 80002, tokenOut: DEST_USDC })).toBe(SOURCE_USDC);
  });

  it('builds a direct native-USDC CCTP approval and burn route', async () => {
    const result = await getQuote({
      fromChain: 11155111,
      fromToken: SOURCE_USDC,
      fromAmount: 10_000_000n,
      toChain: 80002,
      toToken: DEST_USDC,
      fromAddress: USER,
      toAddress: USER,
    }, { swapAdapters: [], bridgeAdapters: [cctp] });

    expect(result.best.route.map((hop) => hop.type)).toEqual(['approval', 'bridge']);
    expect(result.best.route[1]?.fromToken).toBe(SOURCE_USDC);
    expect(result.best.route[1]?.toToken).toBe(DEST_USDC);
    expect(result.best.hopTransactionRequests).toHaveLength(2);
    expect(result.best.hopTransactionRequests?.[1]?.to).toBe(MESSENGER);
  });

  it('composes USDT swap into source USDC before CCTP', async () => {
    let swapRequestToToken = '';
    const swap = {
      id: 'uniswap-v3-test',
      supportedChains: [11155111],
      quoteSwap: async () => ({ amountOut: 9_900_000n, fee: 0n, timeSeconds: 30, reliability: 1, available: true }),
      buildSwapTransaction: async (request: { toToken: string }) => {
        swapRequestToToken = request.toToken;
        return { to: MESSENGER, data: '0x' as const, value: 0n, chainId: 11155111 };
      },
      buildApprovalTransaction: async () => ({ to: SOURCE_USDC, data: '0x' as const, value: 0n, chainId: 11155111 }),
    };
    const result = await getQuote({
      fromChain: 11155111,
      fromToken: '0x5555555555555555555555555555555555555555',
      fromAmount: 10_000_000n,
      toChain: 80002,
      toToken: DEST_USDC,
      fromAddress: USER,
      toAddress: USER,
    }, { swapAdapters: [swap], bridgeAdapters: [cctp] });

    expect(result.best.route.map((hop) => hop.type)).toEqual(['approval', 'swap', 'approval', 'bridge']);
    expect(result.best.route[1]?.toToken).toBe(SOURCE_USDC);
    expect(swapRequestToToken).toBe(SOURCE_USDC);
    expect(result.best.hopTransactionRequests).toHaveLength(4);
  });
});
