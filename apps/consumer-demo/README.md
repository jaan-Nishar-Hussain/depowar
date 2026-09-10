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

For a real deposit, run the API and worker in separate terminals. The worker monitors the first signed transaction and unlocks the next signing step:

```bash
pnpm dev:api
pnpm dev:worker
```

Create `apps/consumer-demo/.env` with:

```ini
VITE_API_URL=http://localhost:4000
VITE_API_KEY=your-integrator-api-key
```

The consumer does not provide a recipient ID: the widget loads the project's configured receiver using the API key. To run the consumer locally against a deployed Test/Live backend, set `VITE_API_URL` to that API origin and use the matching `dw_test_...` or `dw_live_...` key.

For production or repeated local testing, set `VITE_BASE_RPC` to a provider RPC (for example an Alchemy Base mainnet endpoint). The public Base RPC can return `429 Too Many Requests`.

The **Check SDK/API** button calls `listChains()` directly. The widget then exercises the second SDK surface: wallet connection, quote, swipe confirmation, transaction signing, submission reporting, polling, and settlement UI.

## Checks

```bash
pnpm --filter @paymesh/consumer-demo lint
pnpm --filter @paymesh/consumer-demo test
pnpm --filter @paymesh/consumer-demo build
```

The automated test mocks only the API boundary. A real transaction additionally requires a funded MetaMask account, native gas, source-token balance/approval, a configured recipient, a live API/worker/Redis/PostgreSQL stack, and available route liquidity.
