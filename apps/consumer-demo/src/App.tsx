import { useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { PayMeshDeposit } from '@paymesh/widget';
import '@paymesh/widget/styles.css';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const apiKey = import.meta.env.VITE_API_KEY ?? '';
const recipientId = import.meta.env.VITE_RECIPIENT_ID ?? '';
const destinationChain = Number(import.meta.env.VITE_TO_CHAIN ?? 137);
const destinationToken = import.meta.env.VITE_TO_TOKEN ?? '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const baseUsdc = import.meta.env.VITE_BASE_USDC ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const sdk = new PayMeshClient({ baseUrl: apiUrl, apiKey });

export function App() {
  const [sdkStatus, setSdkStatus] = useState('Not checked');

  async function checkSdk() {
    setSdkStatus('Checking API…');
    try {
      const chains = await sdk.listChains();
      setSdkStatus(`SDK connected — ${chains.length} chains returned`);
    } catch (error) {
      setSdkStatus(error instanceof Error ? error.message : 'SDK request failed');
    }
  }

  return (
    <main className="demo-shell">
      <section className="demo-header">
        <div>
          <p className="eyebrow">Clean consumer integration</p>
          <h1>Depowar SDK Demo</h1>
          <p>Direct SDK API check plus the embeddable deposit widget.</p>
        </div>
        <button className="sdk-check" type="button" onClick={checkSdk}>Check SDK/API</button>
      </section>
      <div className="sdk-status" role="status" aria-live="polite">{sdkStatus}</div>
      <PayMeshDeposit
        config={{
          apiUrl,
          apiKey,
          recipientId,
          toChain: destinationChain,
          toToken: destinationToken,
          toTokenDecimals: 6,
          fromTokenByChain: { 8453: baseUsdc },
          supportedTokensByChain: { 8453: [{ symbol: 'USDC', address: baseUsdc, decimals: 6 }] },
          defaultSlippageBps: 50,
        }}
      />
      <p className="demo-note">Configure the VITE_* values in <code>apps/consumer-demo/.env</code> before making a real transaction.</p>
    </main>
  );
}
