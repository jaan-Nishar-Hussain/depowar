import { useEffect, useMemo, useState } from 'react';
import { PayMeshClient } from '@paymesh/sdk';
import { PayMeshDeposit } from '@paymesh/widget';
import '@paymesh/widget/styles.css';

const KNOWN_SYMBOLS: Array<{ symbol: string; address: string }> = [
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // Base
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // Ethereum
  { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }, // Polygon
  { symbol: 'USDC', address: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' }, // Amoy
  { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, // Polygon
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, // Ethereum
  { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' }, // Base
];

function symbolFor(address: string | null | undefined): string {
  if (!address) return 'USDC';
  const hit = KNOWN_SYMBOLS.find((s) => s.address.toLowerCase() === address.toLowerCase());
  return hit?.symbol ?? 'USDC';
}

type Recipient = {
  id: string;
  walletAddress: string;
  preferredChainId?: number | null;
  preferredToken?: string | null;
  settlementConfigs?: Array<{ chainId: number; token: string }>;
};

type WidgetConfig = {
  recipientId: string;
  toChain: number;
  toToken: string;
  toTokenSymbol: string;
  toTokenDecimals: number;
  fromTokenByChain?: Record<number, string>;
  supportedTokensByChain?: Record<number, Array<{ symbol: string; address: string; decimals?: number }>>;
};

const FALLBACK: WidgetConfig = {
  recipientId: '',
  toChain: 137,
  toToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon USDC
  toTokenSymbol: 'USDC',
  toTokenDecimals: 6,
  fromTokenByChain: { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  supportedTokensByChain: { 8453: [{ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }] },
};

/**
 * The demo UI is always visible. The API key (if set) only enriches it with the
 * project's receiver config from the dashboard; without it the widget still
 * renders with a default destination so the SDK flow can be explored.
 */
export function App() {
  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
  const apiKey = import.meta.env.VITE_API_KEY ?? '';
  const sdk = useMemo(() => new PayMeshClient({ baseUrl: apiUrl, apiKey }), [apiUrl, apiKey]);

  const [status, setStatus] = useState(apiKey ? 'Loading project receiver…' : 'No API key set — using a default destination. Add a project API key to load your receiver.');
  const [config, setConfig] = useState<WidgetConfig>(FALLBACK);

  useEffect(() => {
    (async () => {
      if (!apiKey) return;
      try {
        // Prefer explicit env overrides when provided.
        const recipientOverride = import.meta.env.VITE_RECIPIENT_ID;
        const chainOverride = Number(import.meta.env.VITE_TO_CHAIN ?? 0);
        const tokenOverride = import.meta.env.VITE_TO_TOKEN;
        if (recipientOverride && chainOverride && tokenOverride) {
          setConfig({
            recipientId: recipientOverride,
            toChain: chainOverride,
            toToken: tokenOverride,
            toTokenSymbol: import.meta.env.VITE_TO_TOKEN_SYMBOL ?? 'USDC',
            toTokenDecimals: 6,
            fromTokenByChain: FALLBACK.fromTokenByChain,
            supportedTokensByChain: FALLBACK.supportedTokensByChain,
          });
          setStatus('Using explicit VITE_* config');
          return;
        }
        // Auto-bootstrap: load the project's first receiver from the API.
        const recipients = (await sdk.listRecipients()) as Recipient[];
        const recipient = recipients[0];
        if (!recipient) {
          setStatus('Connected — this project has no receiver yet. Add one in the dashboard.');
          return;
        }
        const settlement = recipient.settlementConfigs?.[0];
        const chainId = recipient.preferredChainId ?? settlement?.chainId ?? 137;
        const token = recipient.preferredToken ?? settlement?.token ?? FALLBACK.toToken;
        setConfig({
          recipientId: recipient.id,
          toChain: chainId,
          toToken: token,
          toTokenSymbol: symbolFor(token),
          toTokenDecimals: 6,
          fromTokenByChain: FALLBACK.fromTokenByChain,
          supportedTokensByChain: FALLBACK.supportedTokensByChain,
        });
        setStatus(`Loaded project receiver: ${recipient.walletAddress.slice(0, 8)}…${recipient.walletAddress.slice(-6)} · chain ${chainId} · ${symbolFor(token)}`);
      } catch {
        setStatus('Could not load your project receiver — the widget is still available with a default destination.');
      }
    })();
  }, [apiKey, sdk]);

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
          recipientId: config.recipientId,
          toChain: config.toChain,
          toToken: config.toToken,
          toTokenSymbol: config.toTokenSymbol,
          toTokenDecimals: config.toTokenDecimals,
          fromTokenByChain: config.fromTokenByChain,
          supportedTokensByChain: config.supportedTokensByChain,
          defaultSlippageBps: 50,
        }}
      />
      <p className="demo-note">Add a project API key (<code>VITE_API_KEY</code>) to auto-load your dashboard receiver; otherwise the widget uses a default destination.</p>
    </main>
  );
}