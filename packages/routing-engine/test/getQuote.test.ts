import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { getQuote } from '../src/getQuote';
import { getFallbackQuote } from '../src/fallback';
import { rankRoutes } from '../src/score';
import { createRouteApiAdapter } from '../src/adapters/http/routeApiAdapter';
import type { QuoteRequest } from '../src/types';

const BASE = 'https://api.example-bridge.io';

const server = setupServer(
  http.get(`${BASE}/quote`, () => HttpResponse.json({ outputAmount: '1980000', fee: '6000', timeSeconds: 95, reliability: 0.95 })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const req: QuoteRequest = {
  fromChain: 11155111,
  fromToken: '0x1111111111111111111111111111111111111111',
  fromAmount: 1000000000000000000n,
  toChain: 84532,
  toToken: '0x2222222222222222222222222222222222222222',
  toAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

describe('getQuote with MSW-mocked HTTP provider', () => {
  it('selects the cheaper of two candidate routes', async () => {
    server.use(
      http.get(`${BASE}/quote`, () =>
        HttpResponse.json({
          routes: [
            { id: 'expensive', outputAmount: '1900000', fee: '12000', timeSeconds: 120, reliability: 0.9 },
            { id: 'cheap', outputAmount: '1980000', fee: '6000', timeSeconds: 95, reliability: 0.95 },
          ],
        }),
      ),
    );

    const { best, alternates } = await getQuote(req, {
      swapAdapters: [],
      bridgeAdapters: [],
      routeProviders: [createRouteApiAdapter({ baseUrl: BASE })],
    });

    expect(best.estimatedOutput).toBe(1980000n);
    expect(best.adapterId).toBe('cheap');
    expect(alternates).toHaveLength(1);
    expect(alternates[0]!.estimatedOutput).toBe(1900000n);
  });

  it('throws ROUTE_NOT_FOUND when no candidates exist', async () => {
    server.use(http.get(`${BASE}/quote`, () => HttpResponse.json({ routes: [] })));

    await expect(getQuote(req, { swapAdapters: [], bridgeAdapters: [] })).rejects.toMatchObject({
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('produces a direct route for identical chain + token', async () => {
    const same = { ...req, toChain: req.fromChain, toToken: req.fromToken };
    const { best } = await getQuote(same, { swapAdapters: [], bridgeAdapters: [] });

    expect(best.estimatedOutput).toBe(same.fromAmount);
    expect(best.adapterId).toBe('direct');
    expect(best.transactionRequest).toBeDefined();
  });
});

describe('fallback routing', () => {
  it('re-quotes around a failed adapter', async () => {
    const failed = createRouteApiAdapter({ baseUrl: `${BASE}/failed`, id: 'failed-bridge' });
    const healthy = createRouteApiAdapter({ baseUrl: `${BASE}/healthy`, id: 'healthy-bridge' });

    server.use(
      http.get(`${BASE}/healthy/quote`, () =>
        HttpResponse.json({ routes: [{ id: 'fallback', outputAmount: '1950000', fee: '8000', timeSeconds: 110, reliability: 0.9 }] }),
      ),
    );

    const { best } = await getFallbackQuote(
      req,
      { swapAdapters: [], bridgeAdapters: [], routeProviders: [failed, healthy] },
      ['failed-bridge'],
    );

    expect(best.adapterId).toBe('fallback');
  });

  it('throws ROUTE_NOT_FOUND when every adapter is excluded', async () => {
    const only = createRouteApiAdapter({ baseUrl: BASE, id: 'only-bridge' });

    await expect(
      getFallbackQuote(req, { swapAdapters: [], bridgeAdapters: [], routeProviders: [only] }, ['only-bridge']),
    ).rejects.toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });
});

describe('scoring', () => {
  it('ranks lower-fee, faster, more reliable routes first', () => {
    const candidates = [
      { route: [], estimatedOutput: 1900000n, estimatedTimeSeconds: 120, estimatedFee: 12000n, reliability: 0.9, adapterId: 'a' },
      { route: [], estimatedOutput: 1980000n, estimatedTimeSeconds: 95, estimatedFee: 6000n, reliability: 0.95, adapterId: 'b' },
    ];
    const ranked = rankRoutes(candidates, req);
    expect(ranked[0]!.adapterId).toBe('b');
  });
});