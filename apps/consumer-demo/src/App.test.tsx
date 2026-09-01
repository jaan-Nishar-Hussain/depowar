import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wagmiConfig } from './wagmi';

describe('clean consumer demo', () => {
  it('renders the widget and directly exercises the SDK API client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 200 })));
    render(
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Depowar SDK Demo' })).toBeInTheDocument();
    expect(screen.getByTestId('paymesh-deposit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check SDK/API' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('SDK connected — 1 chains returned'));
  });
});
