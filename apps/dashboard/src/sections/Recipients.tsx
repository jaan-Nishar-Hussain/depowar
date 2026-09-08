import { useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { Card, StatusTag, EmptyState, Spinner, CopyButton, Field, ErrorBanner } from '../components/ui';
import { useApi, chainLabel, shortAddress } from '../lib/useApi';

type Recipient = {
  id: string; walletAddress: string; settlementType: string;
  preferredChainId?: number | null; preferredToken?: string | null;
  createdAt: string;
  settlementConfigs?: Array<{ id: string; chainId: number; token: string; settlementType: string; minAmount?: string | null; maxAmount?: string | null; createdAt: string; enabled: boolean }>;
};

export function Recipients({ client }: { client: PayMeshClient }) {
  const [wallet, setWallet] = useState('');
  const [chainId, setChainId] = useState(137);
  const [token, setToken] = useState('USDC');
  const [settlementType, setSettlementType] = useState<'EOA' | 'CONTRACT'>('EOA');
  const [contractAddress, setContractAddress] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [msg, setMsg] = useState('');

  const list = useApi(client, (c) => c.listRecipients() as Promise<Recipient[]>);

  const selected = (list.data ?? []).find((r) => r.id === selectedId);

  async function createOrUpdate() {
    setMsg('');
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.trim())) { setMsg('Enter a valid 0x wallet address.'); return; }
    try {
      if (selectedId) {
        await client.updateSettlement(selectedId, {
          chainId, token, settlementType,
          ...(contractAddress ? { contractAddress } : {}),
          ...(minAmount ? { minAmount } : {}),
          ...(maxAmount ? { maxAmount } : {}),
        });
        setMsg('Receiver settlement updated.');
      } else {
        await client.createRecipient({ walletAddress: wallet as `0x${string}`, chainId, token });
        setMsg('Receiver created.');
        setWallet('');
      }
      await list.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Unable to save receiver.');
    }
  }

  function select(r: Recipient) {
    setSelectedId(r.id);
    setWallet(r.walletAddress);
    setChainId(r.preferredChainId ?? 137);
    setToken(r.preferredToken === 'native' ? 'USDC' : (r.preferredToken ?? 'USDC'));
    setSettlementType((r.settlementType as 'EOA' | 'CONTRACT') ?? 'EOA');
    setContractAddress('');
    setMinAmount('');
    setMaxAmount('');
  }

  return (
    <div className="recipients-page">
      <div className="grid">
        <Card title={selectedId ? 'Edit receiver' : 'Add receiver'} eyebrow="SETTLEMENT DESTINATION">
          <p className="muted">Funds settle to this wallet on the selected chain and token.</p>
          <Field label="Wallet address">
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" />
          </Field>
          <div className="two">
            <Field label="Destination chain">
              <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
                {[1, 8453, 137, 43114, 42161, 10, 59144, 143].map((id) => <option value={id} key={id}>{chainLabel(id)} · {id}</option>)}
              </select>
            </Field>
            <Field label="Token">
              <select value={token} onChange={(e) => setToken(e.target.value)}><option>USDC</option><option>USDT</option></select>
            </Field>
          </div>
          <div className="two">
            <Field label="Settlement type">
              <select value={settlementType} onChange={(e) => setSettlementType(e.target.value as 'EOA' | 'CONTRACT')}>
                <option value="EOA">EOA (wallet)</option><option value="CONTRACT">Contract</option>
              </select>
            </Field>
            {settlementType === 'CONTRACT' && (
              <Field label="Contract address">
                <input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="0x…" />
              </Field>
            )}
          </div>
          <div className="two">
            <Field label="Min amount (base units)">
              <input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="e.g. 1000000" />
            </Field>
            <Field label="Max amount (base units)">
              <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="e.g. 100000000" />
            </Field>
          </div>
          {msg && <div className="notice">{msg}</div>}
          <button className="primary" disabled={!client} onClick={createOrUpdate}>
            {selectedId ? 'Update receiver' : 'Save destination'}
          </button>
          {selectedId && <button className="link-btn" onClick={() => { setSelectedId(''); setWallet(''); }}>Cancel edit</button>}
        </Card>

        <Card title="Receivers" eyebrow={`${(list.data ?? []).length} CONFIGURED`}>
          {list.loading ? <Spinner /> : (list.data ?? []).length === 0 ? (
            <EmptyState message="No receivers configured yet." />
          ) : (
            <div className="records">
              {(list.data ?? []).map((r) => (
                <button type="button" key={r.id} className={`record record-click ${selectedId === r.id ? 'row-active' : ''}`} onClick={() => select(r)}>
                  <span><strong>{shortAddress(r.walletAddress)}</strong></span>
                  <span>{chainLabel(r.preferredChainId ?? undefined)} · {r.preferredToken === 'native' ? 'native' : r.preferredToken}</span>
                  <span><StatusTag status={r.settlementType} /></span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selected && (
        <Card title="Config history" eyebrow="VERSIONED SETTLEMENT CONFIG" className="config-history">
          {(selected.settlementConfigs ?? []).length === 0 ? <EmptyState message="No config history." /> : (
            <div className="table">
              <div className="row row-head"><span>Chain</span><span>Token</span><span>Type</span><span>Min</span><span>Max</span><span>Created</span><span>Status</span></div>
              {(selected.settlementConfigs ?? []).slice().reverse().map((c) => (
                <div className="row" key={c.id}>
                  <span>{chainLabel(c.chainId)}</span>
                  <span>{c.token === 'native' ? 'native' : `${c.token.slice(0, 6)}…`}</span>
                  <span>{c.settlementType}</span>
                  <span>{c.minAmount ?? '—'}</span>
                  <span>{c.maxAmount ?? '—'}</span>
                  <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  <span><StatusTag status={c.enabled ? 'SETTLED' : 'FAILED'} /></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}