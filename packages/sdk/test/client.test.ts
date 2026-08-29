import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PayMeshClient, ApiRequestError } from '../src';

const BASE = 'http://api.test';

const server = setupServer(
  http.post(`${BASE}/v1/deposit-intents`, () =>
    HttpResponse.json({ depositId: 'dep_1', status: 'PENDING', created: true }, { status: 201 }),
  ),
  http.get(`${BASE}/v1/quote`, () =>
    HttpResponse.json({
      quoteId: 'qt_1',
      depositId: 'dep_1',
      route: [{ type: 'bridge', fromChain: 11155111, toChain: 84532, protocol: 'mock-bridge' }],
      hopTransactionRequests: [{ to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: '0', chainId: 11155111 }],
      estimatedOutput: '1980000',
      estimatedTimeSeconds: 95,
      estimatedFee: '6000',
      reliability: 0.95,
      slippageBps: 50,
      transactionRequest: { to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: '0', chainId: 11155111 },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      alternates: [],
    }),
  ),
  http.get(`${BASE}/v1/status`, () => HttpResponse.json({ id: 'dep_1', status: 'SETTLED', toChainId: 84532, toToken: 'USDC', recipient: { walletAddress: '0x0', settlementType: 'EOA' }, quotes: [], transactions: [] })),
  http.get(`${BASE}/v1/chains`, () => HttpResponse.json([{ id: 11155111, name: 'Ethereum Sepolia', testnet: true }])),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = new PayMeshClient({ baseUrl: BASE, apiKey: 'pm_test' });

describe('PayMeshClient', () => {
  it('creates a deposit intent', async () => {
    const result = await client.createDepositIntent({ recipientId: 'rec_1', toChain: 84532, toToken: 'USDC' });
    expect(result.depositId).toBe('dep_1');
    expect(result.created).toBe(true);
  });

  it('quotes a route and exposes signable hop transactions', async () => {
    const quote = await client.getQuote({
      depositId: 'dep_1',
      fromChain: 11155111,
      fromToken: '0x1111111111111111111111111111111111111111',
      fromAmount: '1000000000000000000',
    });
    expect(quote.quoteId).toBe('qt_1');
    expect(quote.hopTransactionRequests).toHaveLength(1);
    expect(quote.estimatedOutput).toBe('1980000');
  });

  it('polls status until settled', async () => {
    const status = await client.pollUntilSettled('dep_1', { intervalMs: 50, timeoutMs: 2_000 });
    expect(status.status).toBe('SETTLED');
  });

  it('surfaces typed API errors with user-facing messages', async () => {
    server.use(
      http.get(`${BASE}/v1/quote`, () =>
        HttpResponse.json(
          { error: { code: 'ROUTE_NOT_FOUND', message: 'nope', userMessage: 'No route available.' }, requestId: 'r1' },
          { status: 404 },
        ),
      ),
    );
    await expect(
      client.getQuote({ depositId: 'dep_1', fromChain: 1, fromToken: '0x0', fromAmount: '1' }),
    ).rejects.toMatchObject({ code: 'ROUTE_NOT_FOUND', status: 404 });
  });

  it('lists supported chains', async () => {
    const chains = await client.listChains();
    expect(chains[0]!.id).toBe(11155111);
  });
});