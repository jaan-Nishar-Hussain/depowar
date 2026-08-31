import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PayMeshDeposit } from '@paymesh/widget';
import { wagmiConfig } from './lib/wagmi';

const queryClient = new QueryClient();

function DepositConfigCard() {
  const paymentAsset = (import.meta.env.VITE_PAYMENT_ASSET ?? 'USDC').toUpperCase();
  const isUsdt = paymentAsset === 'USDT';
  const config = {
    apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
    apiKey: import.meta.env.VITE_API_KEY ?? '',
    recipientId: import.meta.env.VITE_RECIPIENT_ID ?? '',
    toChain: Number(import.meta.env.VITE_TO_CHAIN ?? 137),
    toToken: import.meta.env.VITE_TO_TOKEN ?? '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    toTokenDecimals: Number(import.meta.env.VITE_TO_TOKEN_DECIMALS ?? 6),
    fromToken: import.meta.env.VITE_FROM_TOKEN ?? 'native',
    fromTokenByChain: isUsdt
      ? {
          11155111: import.meta.env.VITE_SEPOLIA_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          84532: import.meta.env.VITE_BASE_SEPOLIA_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          1: import.meta.env.VITE_ETHEREUM_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          8453: import.meta.env.VITE_BASE_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          137: import.meta.env.VITE_POLYGON_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
        }
      : {
        11155111: import.meta.env.VITE_SEPOLIA_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
        84532: import.meta.env.VITE_BASE_SEPOLIA_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          1: import.meta.env.VITE_ETHEREUM_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          8453: import.meta.env.VITE_BASE_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          137: import.meta.env.VITE_POLYGON_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
      },
  };
  return <PayMeshDeposit config={config} />;
}

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-slate-950 text-slate-100">
          <div className="mx-auto max-w-2xl px-6 py-10">
            <header className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight">Depowar</h1>
      <p className="mt-1 text-slate-400">Base USDC → Polygon USDT via the best available route.</p>
            </header>
            <DepositConfigCard />
            <footer className="mt-12 border-t border-slate-800 pt-4 text-xs text-slate-500">
              Non-custodial routing & settlement. Configure a real route provider for public-testnet execution.
            </footer>
          </div>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
