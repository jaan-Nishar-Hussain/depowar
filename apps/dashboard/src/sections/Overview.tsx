import { PayMeshClient } from '@paymesh/sdk';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Stat, StatusTag, EmptyState, Spinner } from '../components/ui';
import { useApi, formatBaseUnits, chainLabel, shortAddress } from '../lib/useApi';

type AnalyticsOverview = {
  totalDeposits: number; settledDeposits: number; successRate: number;
  averageSettlementTimeSeconds: number; fallbackQuoteCount?: number;
  averageFeePerSettledDeposit?: number; averageOutputPerSettledDeposit?: number;
  recentDeposits: Array<{ id: string; status: string; toChainId: number; toToken: string }>;
};

type ProviderHealth = {
  providers: Record<string, { enabled?: boolean; healthy?: boolean; status?: number; configured?: boolean; latencyMs?: number; networks?: number[] }>;
};

export function Overview({ client }: { client: PayMeshClient }) {
  const analytics = useApi(client, (c) => c.getAnalytics(30) as Promise<AnalyticsOverview>);
  const series = useApi(client, (c) => c.getAnalyticsTimeseries(30));
  const health = useApi(client, (c) => c.getProviderHealth() as Promise<ProviderHealth>);

  const a = analytics.data;
  const chartData = (series.data?.series ?? []).map((s) => ({
    day: s.day.slice(5),
    deposits: s.deposits,
    settled: s.settled,
    volume: Number(formatBaseUnits(s.settledVolume)),
  }));

  return (
    <div className="overview">
      <section className="stats">
        <Stat label="Deposits" value={a?.totalDeposits ?? '—'} />
        <Stat label="Settled" value={a?.settledDeposits ?? '—'} />
        <Stat label="Success rate" value={a ? `${(a.successRate * 100).toFixed(1)}%` : '—'} />
        <Stat label="Avg. settlement" value={a ? `${a.averageSettlementTimeSeconds}s` : '—'} hint="Time from execute to settle" />
        <Stat label="Fallback re-quotes" value={a?.fallbackQuoteCount ?? '—'} />
      </section>

      {series.loading ? <Spinner /> : (
        <Card title="Deposit & settlement volume" eyebrow="LAST 30 DAYS" className="chart-card">
          {chartData.length === 0 ? <EmptyState message="No deposits in this period yet." /> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#41d88a" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#41d88a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2939" />
                <XAxis dataKey="day" tick={{ fill: '#8f9bb0', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8f9bb0', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#0b121d', border: '1px solid #273348', borderRadius: 8, color: '#e8edf7' }} />
                <Area type="monotone" dataKey="volume" name="Settled USDC" stroke="#41d88a" fill="url(#v)" />
                <Area type="monotone" dataKey="settled" name="Settled count" stroke="#3b82f6" fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

      <div className="overview-grid">
        <Card title="Provider health" eyebrow="LIVE STATUS">
          {health.loading ? <Spinner /> : (
            <div className="provider-health">
              {Object.entries(health.data?.providers ?? {}).map(([name, p]) => {
                const state = !p.enabled ? 'off' : p.healthy ? 'ok' : 'down';
                return (
                  <div className={`health-row health-${state}`} key={name}>
                    <span className="health-name">{name}</span>
                    <span className="health-dot" aria-hidden="true" />
                    <span className="health-state">
                      {!p.enabled ? 'disabled' : p.healthy ? 'healthy' : `down${p.status ? ` (${p.status})` : ''}`}
                    </span>
                    {p.latencyMs !== undefined && <span className="health-latency">{p.latencyMs}ms</span>}
                    {p.networks && <span className="health-networks">{p.networks.length} chains</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Recent activity" eyebrow="LATEST DEPOSITS">
          {analytics.loading ? <Spinner /> : a?.recentDeposits?.length ? (
            <div className="records">
              {a.recentDeposits.slice(0, 6).map((d) => (
                <div className="record" key={d.id}>
                  <span><code>{d.id.slice(0, 10)}</code></span>
                  <span>{chainLabel(d.toChainId)}</span>
                  <StatusTag status={d.status} />
                </div>
              ))}
            </div>
          ) : <EmptyState message="No activity yet — make your first deposit." />}
        </Card>
      </div>

      {a && a.averageFeePerSettledDeposit !== undefined && (
        <Card title="Cost efficiency" eyebrow="PER SETTLED DEPOSIT">
          <div className="analytics-grid">
            <div className="metric"><span>Avg. output</span><strong>{formatBaseUnits(Math.round(a.averageOutputPerSettledDeposit ?? 0))}</strong></div>
            <div className="metric"><span>Avg. fee</span><strong>{formatBaseUnits(Math.round(a.averageFeePerSettledDeposit ?? 0))}</strong></div>
            <div className="metric"><span>Avg. slippage-adjusted</span><strong>{a.averageFeePerSettledDeposit && a.averageOutputPerSettledDeposit ? `${((a.averageFeePerSettledDeposit / a.averageOutputPerSettledDeposit) * 100).toFixed(2)}%` : '—'}</strong></div>
          </div>
        </Card>
      )}
    </div>
  );
}

export function RecentRecipientSummary({ recipient }: { recipient: { walletAddress?: string; preferredChainId?: number } | undefined }) {
  return (
    <div className="muted" style={{ fontSize: 12 }}>
      {recipient ? `${shortAddress(recipient.walletAddress)} · ${chainLabel(recipient.preferredChainId)}` : 'No recipient configured'}
    </div>
  );
}