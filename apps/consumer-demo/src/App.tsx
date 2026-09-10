import { useMemo, useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { PayMeshDeposit } from '@paymesh/widget';
import '@paymesh/widget/styles.css';

type WidgetConfig = {
  fromTokenByChain?: Record<number, string>;
  supportedTokensByChain?: Record<number, Array<{ symbol: string; address: string; decimals?: number }>>;
};

const FALLBACK: WidgetConfig = {
  fromTokenByChain: { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  supportedTokensByChain: { 8453: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }] },
};

/**
 * The demo UI is always visible. The API key (if set) only enriches it with the
 * project's receiver config from the dashboard. The recipient ID is an
 * internal project value and is never entered by the consumer.
 */
export function App() {
  // The UI may run locally while targeting a deployed Test or Live API.
  // Localhost remains the default for local end-to-end development.
  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
  const apiKey = import.meta.env.VITE_API_KEY ?? '';
  const sdk = useMemo(() => new PayMeshClient({ baseUrl: apiUrl, apiKey }), [apiUrl, apiKey]);

  const [status, setStatus] = useState(apiKey
    ? 'Ready — the widget will load the project receiver from your API key.'
    : 'No API key set — add the project API key to load the receiver.');

  return (
    <main className="demo-shell">
      <section className="demo-header">
        <div>
          <p className="eyebrow">Clean consumer integration</p>
          <h1>Depowar SDK Demo</h1>
          <p>Widget + SDK backed by the same routing API.</p>
        </div>
        <button className="sdk-check" type="button" onClick={async () => {
          setStatus('Checking API…');
          try {
            const chains = await sdk.listChains();
            setStatus(`SDK connected — ${chains.length} chains returned`);
          } catch {
            setStatus('SDK could not reach the API — is it running on :4000? The widget still works for the UI flow.');
          }
        }}>Check SDK/API</button>
      </section>
      <div className="sdk-status" role="status" aria-live="polite">{status}</div>
      <PayMeshDeposit
        config={{
          apiUrl,
          apiKey,
          fromTokenByChain: FALLBACK.fromTokenByChain,
          supportedTokensByChain: FALLBACK.supportedTokensByChain,
          defaultSlippageBps: 50,
        }}
      />
      <p className="demo-note">Add a project API key (<code>VITE_API_KEY</code>) to auto-load the dashboard receiver.</p>
    </main>
  );
}
