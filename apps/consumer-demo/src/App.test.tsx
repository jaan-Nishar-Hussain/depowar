import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wagmiConfig } from './wagmi';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('clean consumer demo', () => {
  it('bootstraps from the project API key + receiver and renders the widget', async () => {
    vi.stubEnv('VITE_API_KEY', 'dw_test_demo');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/recipients')) {
        return new Response(JSON.stringify([{
          id: 'rec_1',
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          preferredChainId: 137,
          preferredToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
          settlementConfigs: [{ chainId: 137, token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }],
        }]), { status: 200 });
      }
      if (url.includes('/v1/chains')) return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    render(
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Depowar SDK Demo' })).toBeInTheDocument();
    // Auto-bootstrap loads the project's receiver from the API.
    await waitFor(() => expect(screen.getByTestId('paymesh-deposit')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/Loaded project receiver/);

    fireEvent.click(screen.getByRole('button', { name: 'Check SDK/API' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('SDK connected — 1 chains returned'));
  });

  it('shows a hint when no API key is set', () => {
    render(
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/No VITE_API_KEY set/);
  });
});