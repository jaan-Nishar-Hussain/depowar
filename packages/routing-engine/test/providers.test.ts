import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { createOneInchAdapter } from '../src/adapters/dex/oneInchAdapter';
import { createAcrossAdapter } from '../src/adapters/bridge/acrossAdapter';

const ONEINCH = 'https://api.1inch.test';
const ACROSS = 'https://api.across.test';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const req = {
  fromChain: 1,
  fromToken: '0x1111111111111111111111111111111111111111',
  fromAmount: 1_000_000n,
  toChain: 8453,
  toToken: '0x2222222222222222222222222222222222222222',
  fromAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
  toAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
};

describe('1inch adapter', () => {
  it('quotes via /quote and parses dstAmount', async () => {
    server.use(
      http.get(`${ONEINCH}/swap/v6.0/1/quote`, () =>
        HttpResponse.json({ dstAmount: '995000' })),
    );
    const adapter = createOneInchAdapter({ baseUrl: ONEINCH, chains: [1], routerAddress: '0x111111125421cA6dc452d289314280a0f8842A65' as const });
    const quote = await adapter.quoteSwap({ chain: 1, tokenIn: req.fromToken, tokenOut: req.toToken, amountIn: req.fromAmount });
    expect(quote.amountOut).toBe(995_000n);
    expect(quote.available).toBe(true);
  });

  it('reports unavailable on chains outside its support', async () => {
    const adapter = createOneInchAdapter({ baseUrl: ONEINCH, chains: [1], routerAddress: '0x111111125421cA6dc452d289314280a0f8842A65' as const });
    const quote = await adapter.quoteSwap({ chain: 137, tokenIn: req.fromToken, tokenOut: req.toToken, amountIn: req.fromAmount });
    expect(quote.available).toBe(false);
  });

  it('builds a swap transaction from the /swap endpoint', async () => {
    server.use(
      http.get(`${ONEINCH}/swap/v6.0/1/swap`, () =>
        HttpResponse.json({ dstAmount: '995000', tx: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0', from: req.fromAddress } })),
    );
    const adapter = createOneInchAdapter({ baseUrl: ONEINCH, chains: [1], routerAddress: '0x111111125421cA6dc452d289314280a0f8842A65' as const });
    const tx = await adapter.buildSwapTransaction(req, { amountOut: 995_000n, fee: 0n, timeSeconds: 30, reliability: 0.98 });
    expect(tx.to).toBe('0x3333333333333333333333333333333333333333');
    expect(tx.data).toBe('0xdeadbeef');
    expect(tx.from).toBe(req.fromAddress);
  });
});

describe('Across adapter', () => {
  it('is inert when disabled (mainnet-only guard)', async () => {
    const adapter = createAcrossAdapter({ enabled: false });
    const quote = await adapter.quoteBridge({ fromChain: 1, toChain: 8453, tokenIn: req.fromToken, tokenOut: req.toToken, amountIn: req.fromAmount });
    expect(quote.available).toBe(false);
    expect(adapter.supportedFromChains).toHaveLength(0);
  });

  it('quotes and builds transactions when enabled', async () => {
    server.use(
      http.get(`${ACROSS}/swap/quote`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('depositor')) {
          return HttpResponse.json({ to: '0x3333333333333333333333333333333333333333', data: '0xabc', value: '0' });
        }
        return HttpResponse.json({ outputAmount: '998000', expectedFillTime: 12 });
      }),
    );
    const adapter = createAcrossAdapter({ enabled: true, baseUrl: ACROSS });
    const quote = await adapter.quoteBridge({ fromChain: 1, toChain: 8453, tokenIn: req.fromToken, tokenOut: req.toToken, amountIn: req.fromAmount });
    expect(quote.amountOut).toBe(998_000n);
    expect(quote.timeSeconds).toBe(15);
    const tx = await adapter.buildBridgeTransaction(req, quote);
    expect(tx.to).toBe('0x3333333333333333333333333333333333333333');
    expect(tx.data).toBe('0xabc');
  });
});
