import { PayMeshClient } from '@paymesh/sdk';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, Spinner } from '../components/ui';
import { useApi, formatBaseUnits } from '../lib/useApi';

export function Analytics({ client }: { client: PayMeshClient }) {
  const overview = useApi(client, (c) => c.getAnalytics(30) as Promise<{
    totalDeposits: number; settledDeposits: number; successRate: number; averageSettlementTimeSeconds: number;
    statusCounts?: Record<string, number>; providerBreakdown?: Record<string, number>; fallbackQuoteCount?: number;
    averageFeePerSettledDeposit?: number; averageOutputPerSettledDeposit?: number;
    topSourceChains?: Record<number, number>; topTokens?: Record<string, number>;
  }>);
  const series = useApi(client, (c) => c.getAnalyticsTimeseries(30));

  const o = overview.data;
  const statusEntries = Object.entries(o?.statusCounts ?? {}).sort((a, b) => b[1] - a[1]);
  const providerEntries = Object.entries(o?.providerBreakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const chainEntries = Object.entries(o?.topSourceChains ?? {}).sort((a, b) => b[1] - a[1]);
  const tokenEntries = Object.entries(o?.topTokens ?? {}).sort((a, b) => b[1] - a[1]);
  const chartData = (series.data?.series ?? []).map((s) => ({
    day: s.day.slice(5), deposits: s.deposits, settled: s.settled,
    volume: Number(formatBaseUnits(s.settledVolume)),
  }));

  return (
    <div className="analytics-page">
      <div className="analytics-grid">
        <div className="metric"><span>Total deposits</span><strong>{o?.totalDeposits ?? '—'}</strong></div>
        <div className="metric"><span>Settled</span><strong>{o?.settledDeposits ?? '—'}</strong></div>
        <div className="metric"><span>Success rate</span><strong>{o ? `${(o.successRate * 100).toFixed(1)}%` : '—'}</strong></div>
        <div className="metric"><span>Avg. settlement</span><strong>{o ? `${o.averageSettlementTimeSeconds}s` : '—'}</strong></div>
        <div className="metric"><span>Fallbacks</span><strong>{o?.fallbackQuoteCount ?? '—'}</strong></div>
        <div className="metric"><span>Avg. fee / deposit</span><strong>{o?.averageFeePerSettledDeposit !== undefined ? formatBaseUnits(Math.round(o.averageFeePerSettledDeposit)) : '—'}</strong></div>
      </div>

      {series.loading ? <Spinner /> : (
        <Card title="Daily volume & settlement" eyebrow="LAST 30 DAYS" className="chart-card">
          {chartData.length === 0 ? <EmptyState message="No data in this period yet." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2939" />
                <XAxis dataKey="day" tick={{ fill: '#8f9bb0', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8f9bb0', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#0b121d', border: '1px solid #273348', borderRadius: 8, color: '#e8edf7' }} />
                <Bar dataKey="deposits" name="Deposits" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="settled" name="Settled" fill="#41d88a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

      <div className="grid">
        <Card title="Status distribution" eyebrow="BY DEPOSIT STATE">
          {statusEntries.length === 0 ? <EmptyState message="No status data yet." /> : (
            <div className="provider-bars">
              {statusEntries.map(([status, value]) => (
                <div className="provider-bar" key={status}>
                  <span className="provider-bar__label">{status}</span>
                  <div className="provider-bar__track"><div className="provider-bar__fill" style={{ width: `${(value / Math.max(...statusEntries.map(([, v]) => v))) * 100}%` }} /></div>
                  <span className="provider-bar__value">{value}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Provider breakdown" eyebrow="WHICH RAIL WON">
          {providerEntries.length === 0 ? <EmptyState message="No provider data yet." /> : (
            <div className="provider-bars">
              {providerEntries.map(([provider, value]) => (
                <div className="provider-bar" key={provider}>
                  <span className="provider-bar__label">{provider}</span>
                  <div className="provider-bar__track"><div className="provider-bar__fill" style={{ width: `${(value / Math.max(...providerEntries.map(([, v]) => v))) * 100}%` }} /></div>
                  <span className="provider-bar__value">{value}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid">
        <Card title="Top source chains" eyebrow="WHERE FUNDS COME FROM">
          {chainEntries.length === 0 ? <EmptyState message="No source chain data yet." /> : (
            <div className="records">{chainEntries.map(([id, count]) => <div className="record" key={id}><span>Chain {id}</span><span>{count}</span></div>)}</div>
          )}
        </Card>
        <Card title="Top source tokens" eyebrow="INPUT ASSETS">
          {tokenEntries.length === 0 ? <EmptyState message="No token data yet." /> : (
            <div className="records">{tokenEntries.map(([token, count]) => <div className="record" key={token}><span><code>{token.slice(0, 10)}…</code></span><span>{count}</span></div>)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}