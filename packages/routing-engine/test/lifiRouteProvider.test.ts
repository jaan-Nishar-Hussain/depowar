import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createLifiRouteProvider } from '../src/adapters/http/lifiRouteProvider';

const BASE = 'https://li-fi.test/v1';
const server = setupServer(
  http.get(`${BASE}/quote`, () => HttpResponse.json({
    id: 'quote-1',
    tool: 'test-bridge',
    action: { fromChainId: 11155111, toChainId: 80002 },
    estimate: {
      toAmount: '9900000',
      toAmountMin: '9850000',
      executionDuration: 90,
      gasCosts: [{ amount: '100000000000000' }],
      feeCosts: [{ amount: '1000' }],
      approvalAddress: '0x5555555555555555555555555555555555555555',
    },
    transactionRequest: {
      to: '0x6666666666666666666666666666666666666666',
      data: '0xabcdef',
      value: '0x0',
      chainId: 11155111,
    },
  })),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('LI.FI route provider', () => {
  it('converts a ready-to-sign quote into aligned approval and action hops', async () => {
    const provider = createLifiRouteProvider({ baseUrl: BASE });
    const [candidate] = await provider.getCandidateRoutes({
      fromChain: 11155111,
      toChain: 80002,
      fromToken: '0x1111111111111111111111111111111111111111',
      toToken: '0x2222222222222222222222222222222222222222',
      fromAmount: 10_000_000n,
      fromAddress: '0x3333333333333333333333333333333333333333',
      toAddress: '0x4444444444444444444444444444444444444444',
    });
    expect(candidate?.route.map((hop) => hop.type)).toEqual(['approval', 'bridge']);
    expect(candidate?.hopTransactionRequests).toHaveLength(2);
    expect(candidate?.estimatedOutput).toBe(9_850_000n);
    expect(candidate?.gasCost).toBe(100_000_000_000_000n);
  });
});
