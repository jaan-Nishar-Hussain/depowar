import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PayMeshClient } from '@paymesh/sdk';
import { Overview } from './Overview';
import { Deposits } from './Deposits';
import { Access } from './Access';

function stubClient(): PayMeshClient {
  return {
    getAnalytics: async () => ({
      totalDeposits: 10, settledDeposits: 8, successRate: 0.8, averageSettlementTimeSeconds: 95,
      fallbackQuoteCount: 1, recentDeposits: [{ id: 'dep_1', status: 'SETTLED', toChainId: 137, toToken: '0xusdc' }],
      statusCounts: { SETTLED: 8, PENDING: 2 }, providerBreakdown: { lifi: 6, cctp: 2 },
      averageFeePerSettledDeposit: 1000, averageOutputPerSettledDeposit: 990000,
    }),
    getAnalyticsTimeseries: async () => ({
      days: 7,
      series: [{ day: '2026-09-01', deposits: 1, settled: 1, failed: 0, volume: '1000000', settledVolume: '1000000' }],
    }),
    getProviderHealth: async () => ({
      providers: {
        lifi: { enabled: true, healthy: true, status: 200, latencyMs: 300 },
        cctp: { enabled: true, healthy: true },
        across: { enabled: true, healthy: false, status: 503 },
        oneInch: { enabled: false },
      },
    }),
    listDepositIntents: async () => ({
      items: [{
        id: 'dep_1', status: 'SETTLED', toChainId: 137, toToken: '0xusdt', recipientWallet: '0xwallet',
        fromChainId: 8453, fromToken: '0xusdc', fromAmount: '1000000', estimatedOutput: '981809',
        providerId: 'lifi', transactionCount: 2, confirmedTransactions: 2, createdAt: '2026-09-01T00:00:00Z',
      }],
      total: 1, page: 1, limit: 15,
    }),
    getStatus: async () => ({
      id: 'dep_1', status: 'SETTLED', toChainId: 137, toToken: '0xusdt', recipient: { walletAddress: '0xwallet' },
      quotes: [{ id: 'qt_1', status: 'ACTIVE', providerId: 'lifi', routePath: [{ type: 'bridge', protocol: 'lifi:lifiIntents', fromToken: '0xusdc', toToken: '0xusdt', amountIn: '1000000', amountOut: '981809' }], createdAt: '2026-09-01T00:00:00Z' }],
      transactions: [{ id: 'tx_1', hopIndex: 0, txHash: '0xabc', status: 'CONFIRMED', chainId: 8453 }],
    }),
    listApiKeys: async () => [],
    listWebhooks: async () => [],
    listWebhookDeliveries: async () => ({ items: [] }),
  } as unknown as PayMeshClient;
}

describe('dashboard sections', () => {
  it('renders overview KPIs and provider health', async () => {
    render(<Overview client={stubClient()} />);
    expect(await screen.findByText('10')).toBeInTheDocument(); // deposits KPI
    expect(screen.getByText('80.0%')).toBeInTheDocument(); // success rate
    expect(await screen.findByText('lifi')).toBeInTheDocument(); // provider health
    expect(screen.getAllByText(/healthy/).length).toBeGreaterThan(0);
  });

  it('renders the deposits table with drill-down', async () => {
    render(<Deposits client={stubClient()} />);
    const row = await screen.findByText('lifi'); // provider in the route column
    expect(row).toBeInTheDocument();
    expect(screen.getAllByText(/SETTLED/).length).toBeGreaterThan(0);
  });

  it('renders the access section', async () => {
    render(<Access client={stubClient()} />);
    expect(screen.getByText('API keys')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
  });
});