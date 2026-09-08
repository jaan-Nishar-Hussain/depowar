import { useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { Card, StatusTag, EmptyState, Spinner, Pagination, CopyButton, Field, ErrorBanner } from '../components/ui';
import { useApi, formatBaseUnits, chainLabel, shortAddress } from '../lib/useApi';

type DepositItem = {
  id: string; status: string; toChainId: number; toToken: string;
  recipientWallet?: string; fromChainId?: number | null; fromToken?: string | null;
  fromAmount?: string | null; estimatedOutput?: string | null; providerId?: string | null;
  transactionCount: number; confirmedTransactions: number; createdAt: string;
};

type DepositStatus = {
  id: string; status: string; toChainId: number; toToken: string; fromToken?: string;
  recipient: { walletAddress: string };
  quotes: Array<{
    id: string; status: string; providerId?: string | null; fallbackFromQuoteId?: string | null;
    routePath: Array<{ type: string; protocol?: string; fromToken?: string; toToken?: string; amountIn?: string; amountOut?: string; fromChain?: number; toChain?: number }>;
    createdAt: string;
  }>;
  transactions: Array<{ id: string; hopIndex: number; txHash?: string | null; status: string; errorCode?: string | null; chainId: number; confirmedAt?: string | null; submittedAt?: string | null }>;
};

export function Deposits({ client }: { client: PayMeshClient }) {
  const [filters, setFilters] = useState({ status: '', toChainId: '', search: '' });
  const [page, setPage] = useState(1);
  const limit = 15;
  const [selected, setSelected] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  const list = useApi(client, (c) => c.listDepositIntents({
    status: filters.status || undefined,
    toChainId: filters.toChainId ? Number(filters.toChainId) : undefined,
    search: filters.search || undefined,
    page,
    limit,
  }), [filters.status, filters.toChainId, filters.search, page]);

  const detail = useApi(client, async (c) => {
    if (!selected) return null as unknown as DepositStatus;
    return c.getStatus(selected) as Promise<DepositStatus>;
  }, [selected]);

  const items = list.data?.items ?? [];

  async function handleRetry(depositId: string) {
    try {
      const res = await client.retryDepositIntent(depositId);
      setActionMsg(res.message ?? `Deposit ${depositId} reset for retry.`);
      await list.refresh();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Retry failed');
    }
  }

  return (
    <div className="deposits-page">
      <Card title="Deposits" eyebrow="ACTIVITY">
        <div className="filters">
          <Field label="Status">
            <select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
              <option value="">All statuses</option>
              <option>PENDING</option><option>AWAITING_SIGNATURE</option><option>IN_FLIGHT</option>
              <option>SETTLEMENT_PENDING</option><option>SETTLED</option><option>FAILED</option>
            </select>
          </Field>
          <Field label="Destination chain">
            <select value={filters.toChainId} onChange={(e) => { setFilters({ ...filters, toChainId: e.target.value }); setPage(1); }}>
              <option value="">All chains</option>
              {[1, 8453, 137, 43114, 42161, 10, 59144, 143].map((id) => <option value={id} key={id}>{chainLabel(id)} · {id}</option>)}
            </select>
          </Field>
          <Field label="Search">
            <input placeholder="Deposit id or wallet…" value={filters.search} onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }} />
          </Field>
        </div>

        {actionMsg && <div className="notice">{actionMsg}</div>}

        {list.loading ? <Spinner /> : items.length === 0 ? (
          <EmptyState message="No deposits match the current filters." />
        ) : (
          <div className="table">
            <div className="row row-head">
              <span>Deposit</span><span>From</span><span>To</span><span>Route</span><span>Status</span><span>When</span>
            </div>
            {items.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`row row-click ${selected === d.id ? 'row-active' : ''}`}
                onClick={() => setSelected(selected === d.id ? null : d.id)}
              >
                <span><code>{d.id.slice(0, 10)}</code></span>
                <span>{d.fromChainId ? `${chainLabel(d.fromChainId)} ${shortAddress(d.fromToken ?? undefined)}` : '—'}</span>
                <span>{chainLabel(d.toChainId)}</span>
                <span>{d.providerId ?? '—'}</span>
                <span><StatusTag status={d.status} /></span>
                <span>{new Date(d.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
        <Pagination page={page} total={list.data?.total ?? 0} limit={limit} onChange={setPage} />
      </Card>

      {selected && (
        <DetailPanel
          depositId={selected}
          detail={detail.data}
          loading={detail.loading}
          error={detail.error}
          onRetry={() => handleRetry(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function DetailPanel({ depositId, detail, loading, error, onRetry, onClose }: {
  depositId: string; detail: DepositStatus | null; loading: boolean; error: string | null;
  onRetry: () => void; onClose: () => void;
}) {
  const latest = detail?.quotes?.[0];
  const hops = latest?.routePath ?? [];
  const txs = detail?.transactions ?? [];

  return (
    <Card title={`Deposit ${depositId.slice(0, 14)}…`} eyebrow="DETAIL" className="detail-panel"
      actions={<button type="button" className="link-btn" onClick={onClose}>Close ✕</button>}>
      {loading ? <Spinner /> : error ? <ErrorBanner message={error} /> : !detail ? <EmptyState message="No detail available." /> : (
        <>
          <div className="detail-meta">
            <span><strong>Status</strong> <StatusTag status={detail.status} /></span>
            <span><strong>Destination</strong> {chainLabel(detail.toChainId)}</span>
            <span><strong>Recipient</strong> {shortAddress(detail.recipient?.walletAddress)} <CopyButton text={detail.recipient?.walletAddress ?? ''} label="Copy" /></span>
            <span><strong>Provider</strong> {latest?.providerId ?? '—'}</span>
            {latest?.fallbackFromQuoteId && <span><strong>Fallback from</strong> {latest.fallbackFromQuoteId.slice(0, 10)}</span>}
          </div>

          <p className="eyebrow" style={{ marginTop: 16 }}>ROUTE</p>
          {hops.length === 0 ? <EmptyState message="No route recorded." /> : (
            <div className="table">
              <div className="row row-head"><span>Hop</span><span>Protocol</span><span>Asset</span><span>Amount</span></div>
              {hops.map((h, i) => (
                <div className="row" key={i}>
                  <span>{h.type}</span>
                  <span>{h.protocol ?? '—'}</span>
                  <span>{h.fromToken?.slice(0, 8)}… → {h.toToken?.slice(0, 8)}…</span>
                  <span>{h.amountIn !== undefined ? formatBaseUnits(h.amountIn) : '—'} → {h.amountOut !== undefined ? formatBaseUnits(h.amountOut) : '—'}</span>
                </div>
              ))}
            </div>
          )}

          <p className="eyebrow" style={{ marginTop: 16 }}>TRANSACTIONS</p>
          {txs.length === 0 ? <EmptyState message="No transactions recorded." /> : (
            <div className="table">
              <div className="row row-head"><span>Hop</span><span>Chain</span><span>Tx hash</span><span>Status</span><span>Error</span></div>
              {txs.map((tx) => (
                <div className="row" key={tx.id}>
                  <span>#{tx.hopIndex}</span>
                  <span>{chainLabel(tx.chainId)}</span>
                  <span>{tx.txHash ? <code>{tx.txHash.slice(0, 14)}…</code> : '—'}</span>
                  <span><StatusTag status={tx.status} /></span>
                  <span>{tx.errorCode ?? '—'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="detail-actions">
            {(detail.status === 'FAILED' || detail.status === 'SETTLEMENT_PENDING') && (
              <button type="button" className="primary" onClick={onRetry}>Retry deposit</button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}