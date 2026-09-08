import { useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { Card, StatusTag, EmptyState, Spinner, CopyButton, Field, ErrorBanner } from '../components/ui';
import { useApi } from '../lib/useApi';

type Key = { id: string; keyPrefix: string; scopes: string[]; enabled: boolean; lastUsedAt?: string | null; expiresAt?: string | null; revokedAt?: string | null; createdAt: string };
type Webhook = { id: string; url: string; events: string[]; enabled: boolean; createdAt: string };
type Delivery = { id: string; status: string; attempts: number; responseCode?: number | null; lastError?: string | null; deliveredAt?: string | null; createdAt: string };

export function Access({ client }: { client: PayMeshClient }) {
  const [newKey, setNewKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);

  const keys = useApi(client, (c) => c.listApiKeys() as Promise<Key[]>);
  const webhooks = useApi(client, (c) => c.listWebhooks() as Promise<Webhook[]>);
  const deliveries = useApi(client, async (c) => {
    if (!selectedWebhook) return [] as Delivery[];
    const res = await c.listWebhookDeliveries(selectedWebhook);
    return res.items as Delivery[];
  }, [selectedWebhook]);

  const keyList = keys.data ?? [];
  const hasActiveKey = keyList.some((k) => k.enabled && !k.revokedAt);

  async function createKey() {
    try {
      const result = await client.createApiKey(['deposits', 'quote', 'webhooks']);
      setNewKey(result.key);
      setMsg('Key created — copy it now, it will not be shown again.');
      await keys.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to create key.'); }
  }
  async function revokeKey(id: string) {
    try { await client.revokeApiKey(id); setMsg('Key revoked.'); await keys.refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to revoke key.'); }
  }
  async function createWebhook() {
    if (!/^https?:\/\//.test(webhookUrl.trim())) { setMsg('Enter a valid http(s) URL.'); return; }
    try {
      await client.registerWebhook({ url: webhookUrl.trim(), events: ['quote.ready', 'tx.confirmed', 'deposit.settled', 'deposit.failed'] });
      setWebhookUrl(''); setMsg('Webhook registered.'); await webhooks.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to register webhook.'); }
  }
  async function deleteWebhook(id: string) {
    try { await client.deleteWebhook(id); if (selectedWebhook === id) setSelectedWebhook(null); setMsg('Webhook removed.'); await webhooks.refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Unable to remove webhook.'); }
  }

  return (
    <div className="access-page">
      {msg && <div className="notice">{msg}</div>}

      <div className="grid">
        <Card title="API keys" eyebrow="ACCESS" actions={hasActiveKey ? undefined : <button onClick={createKey} disabled={!client}>Create key</button>}>
          <p className="muted">Keys authenticate SDK requests and belong to this project. One active key per project — revoke it before creating a new one.</p>
          {hasActiveKey && <div className="notice">A key is active for this project. <strong>Revoke it first</strong> to create a new one.</div>}
          {newKey && (
            <div className="secret secret-create">
              <div><strong>Save this API key now</strong><span>It will only be displayed once.</span></div>
              <code>{newKey}</code>
              <CopyButton text={newKey} label="Copy key" />
            </div>
          )}
          {keys.loading ? <Spinner /> : (keys.data ?? []).length === 0 ? <EmptyState message="No API keys yet." /> : (
            <div className="records">
              {(keys.data ?? []).map((k) => (
                <div className="record" key={k.id}>
                  <span><code>{k.keyPrefix}…</code></span>
                  <span>{k.scopes.join(', ') || 'no scopes'}</span>
                  <span>{k.lastUsedAt ? `Used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Never used'}</span>
                  <span><StatusTag status={k.enabled && !k.revokedAt ? 'SETTLED' : 'FAILED'} /></span>
                  {k.enabled && !k.revokedAt && <button className="retry-btn" onClick={() => revokeKey(k.id)}>Revoke</button>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Webhooks" eyebrow="EVENT DELIVERY">
          <p className="muted">Receive HMAC-signed lifecycle events.</p>
          <div className="inline-form">
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-app.example/hooks" />
            <button className="primary" onClick={createWebhook} disabled={!webhookUrl.trim()}>Register</button>
          </div>
          {webhooks.loading ? <Spinner /> : (webhooks.data ?? []).length === 0 ? <EmptyState message="No webhooks registered." /> : (
            <div className="records">
              {(webhooks.data ?? []).map((w) => (
                <div className="record" key={w.id}>
                  <span><code>{w.url}</code></span>
                  <span>{w.events.length} events</span>
                  <button className={`link-btn ${selectedWebhook === w.id ? 'row-active' : ''}`} onClick={() => setSelectedWebhook(selectedWebhook === w.id ? null : w.id)}>
                    {selectedWebhook === w.id ? 'Hide deliveries' : 'Deliveries'}
                  </button>
                  <button className="retry-btn" onClick={() => deleteWebhook(w.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedWebhook && (
        <Card title="Webhook deliveries" eyebrow="DELIVERY LOG">
          {deliveries.loading ? <Spinner /> : (deliveries.data ?? []).length === 0 ? (
            <EmptyState message="No deliveries recorded for this webhook yet." />
          ) : (
            <div className="table">
              <div className="row row-head"><span>Status</span><span>Attempts</span><span>Response</span><span>Last error</span><span>Delivered</span></div>
              {(deliveries.data ?? []).map((d) => (
                <div className="row" key={d.id}>
                  <span><StatusTag status={d.status} /></span>
                  <span>{d.attempts}</span>
                  <span>{d.responseCode ?? '—'}</span>
                  <span>{d.lastError ? <code>{d.lastError.slice(0, 60)}</code> : '—'}</span>
                  <span>{d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}