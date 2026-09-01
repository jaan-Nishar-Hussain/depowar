# Depowar consumer demo

This app is a clean integration example. It imports the public package entry points:

```ts
import { PayMeshClient } from '@paymesh/sdk';
import { PayMeshDeposit } from '@paymesh/widget';
```

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @paymesh/consumer-demo dev
```

Create `apps/consumer-demo/.env` with:

```ini
VITE_API_URL=http://localhost:4000
VITE_API_KEY=your-integrator-api-key
VITE_RECIPIENT_ID=your-recipient-id
VITE_TO_CHAIN=137
VITE_TO_TOKEN=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
VITE_BASE_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
VITE_BASE_RPC=https://mainnet.base.org
```

The **Check SDK/API** button calls `listChains()` directly. The widget then exercises the second SDK surface: wallet connection, quote, swipe confirmation, transaction signing, submission reporting, polling, and settlement UI.

## Checks

```bash
pnpm --filter @paymesh/consumer-demo lint
pnpm --filter @paymesh/consumer-demo test
pnpm --filter @paymesh/consumer-demo build
```

The automated test mocks only the API boundary. A real transaction additionally requires a funded MetaMask account, native gas, source-token balance/approval, a configured recipient, a live API/worker/Redis/PostgreSQL stack, and available route liquidity.
