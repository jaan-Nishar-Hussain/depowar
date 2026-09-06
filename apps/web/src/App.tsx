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
    toTokenSymbol: import.meta.env.VITE_TO_TOKEN_SYMBOL ?? 'USDC',
    toTokenDecimals: Number(import.meta.env.VITE_TO_TOKEN_DECIMALS ?? 6),
    fromToken: import.meta.env.VITE_FROM_TOKEN ?? 'native',
    fromTokenByChain: isUsdt
      ? {
          11155111: import.meta.env.VITE_SEPOLIA_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          84532: import.meta.env.VITE_BASE_SEPOLIA_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          1: import.meta.env.VITE_ETHEREUM_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          8453: import.meta.env.VITE_BASE_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          137: import.meta.env.VITE_POLYGON_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          42161: import.meta.env.VITE_ARBITRUM_MAINNET_USDT ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
        }
      : {
        11155111: import.meta.env.VITE_SEPOLIA_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
        84532: import.meta.env.VITE_BASE_SEPOLIA_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          1: import.meta.env.VITE_ETHEREUM_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          8453: import.meta.env.VITE_BASE_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          137: import.meta.env.VITE_POLYGON_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
          42161: import.meta.env.VITE_ARBITRUM_MAINNET_USDC ?? import.meta.env.VITE_FROM_TOKEN ?? 'native',
      },
    supportedTokensByChain: {
      1: [
        { symbol: 'USDC', address: import.meta.env.VITE_ETHEREUM_MAINNET_USDC ?? '' },
        { symbol: 'USDT', address: import.meta.env.VITE_ETHEREUM_MAINNET_USDT ?? '' },
      ].filter((token) => token.address),
      8453: [
        { symbol: 'USDC', address: import.meta.env.VITE_BASE_MAINNET_USDC ?? '' },
        { symbol: 'USDT', address: import.meta.env.VITE_BASE_MAINNET_USDT ?? '' },
      ].filter((token) => token.address),
      137: [
        { symbol: 'USDC', address: import.meta.env.VITE_POLYGON_MAINNET_USDC ?? '' },
        { symbol: 'USDT', address: import.meta.env.VITE_POLYGON_MAINNET_USDT ?? '' },
      ].filter((token) => token.address),
      43114: [
        { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
        { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBC13d4dF4A8c7' },
      ],
      42161: [
        { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
        { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
      ],
      10: [
        { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
        { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499Ad98a8ce58e58' },
      ],
      59144: [
        { symbol: 'USDC', address: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff' },
        { symbol: 'USDT', address: '0xa219439258ca9da29e9cc4ce5596924745e12b93' },
      ],
      143: [{ symbol: 'USDC', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' }],
    },
  };
  return <PayMeshDeposit config={config} />;
}

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
          .dw-root {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            background-color: #0f0f11;
            background-image:
              linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
            background-size: 28px 28px;
          }
        `}</style>
        <div className="dw-root">
          <DepositConfigCard />
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
