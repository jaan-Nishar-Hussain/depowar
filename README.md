# Depowar — Universal Deposit Layer

## Current testnet scope

The supported three-chain pilot is intentionally fixed to:

- Ethereum Sepolia (`11155111`) and Base Sepolia (`84532`) as source chains
- Polygon Amoy (`80002`) as the only settlement chain

Users can send from either source chain; recipient settlement is always on Polygon Amoy.

The routing core is provider-independent: `RouteHandler` evaluates every
compatible swap × bridge route, rejects unavailable providers, and ranks
complete routes using output, cost, time, slippage, liquidity, reliability,
and risk. External route APIs can be configured with `ROUTE_PROVIDER_URLS`.
The real MVP path is Uniswap V3 USDT→USDC followed by Circle CCTP V2 USDC
settlement. LI.FI remains an optional provider adapter and is not required.

A non-custodial routing and settlement layer: a payer sends **any asset on any chain**, Depowar finds the best route (swap + bridge + swap), and the recipient receives **exactly what they configured** — an EOA, a contract, or a specific token on a specific chain. Depowar never holds funds; every hop is a sender-signed on-chain transaction.

Full spec: [`docs/PRD.md`](docs/PRD.md).

## Mainnet rollout

Mainnet support is configuration-driven for Ethereum (`1`), Base (`8453`),
and Polygon PoS (`137`). The same route engine can combine Uniswap V3 for
source-chain swaps with CCTP V2 for native USDC settlement, while LI.FI and
additional HTTP providers can contribute alternative executable routes through
`LIFI_ENABLED=true` or `ROUTE_PROVIDER_URLS`. Providers are scored together;
an unavailable quote is discarded rather than treated as liquidity.

Set `PAYMESH_DEST_CHAIN_ID=137` (or set `PAYMESH_DEST_CHAIN_IDS=137,8453,42161` to enable multiple destinations), use production RPCs, set
`CCTP_IRIS_API_URL=https://iris-api.circle.com`, configure the destination
MessageTransmitter and a dedicated relayer, then perform a small canary. Do
not reuse testnet keys or enable mock routes in production. Mainnet protocol
addresses are kept in `.env.example` and should be checked against the
official deployment registries before launch.

### Developer management API

Management endpoints use an API key with the `management` scope. A dashboard
can use them to configure a project without exposing LI.FI credentials:

```text
GET    /v1/project
PUT    /v1/project                  { "name": "My integration" }
GET    /v1/api-keys
POST   /v1/api-keys                 { "scopes": ["deposits", "quote"] }
DELETE /v1/api-keys/:id
GET    /v1/recipients
POST   /v1/recipients               { "walletAddress": "0x...", "chainId": 137, "token": "0x..." }
GET    /v1/analytics/overview?days=30
```

`POST /v1/api-keys` returns the plaintext key once; only its hash is stored.
The recipient response contains the `recipientId` used by the SDK. The server
validates the destination chain against `PAYMESH_DEST_CHAIN_IDS` and validates
the token against the chain registry.

## Next-gen routing engine

The route engine is provider-federated and composes routes through an internal
route graph: nodes are (chain, token) pairs and adapters provide edges
(`src/graph/` in `packages/routing-engine`). Candidates — both whole routes
from LI.FI/HTTP providers and composed multi-leg paths (swap → swap → bridge) —
are validated with hard filters (output floor, price-impact ceiling, hop
continuity) before weighted scoring. Optional federated providers are enabled
via env: 1inch (`ONEINCH_ENABLED`), Across (`ACROSS_ENABLED`, mainnet-only),
and Chainlink CCIP (`CCIP_ENABLED`, backup rail). Routing KPIs (candidates
considered/chosen/discard reasons, quote latency, fallback requotes) are
exposed in Prometheus format at `GET /v1/metrics`. Mid-route failures trigger a
partial-route fallback that re-quotes from the intermediate (chain, token,
amount) state so confirmed hops are never double-counted.

### Mainnet preview / canary

`scripts/mainnet-preview.mjs` is the safe-by-default mainnet tool: it quotes
the best federated route and `eth_call`-simulates the first hop without
broadcasting anything. Broadcasting real funds requires `APP_ENV=production`
**and** `--confirm-live` (with a 10-second abort window):

```bash
node scripts/mainnet-preview.mjs --fromChain 1 --fromToken USDT --fromAmount 10 \
  --toChain 8453 --toToken USDC --recipient 0xYourWallet
```

Failure/recovery semantics: see [`docs/stuck-fund-recovery.md`](docs/stuck-fund-recovery.md).

### Mainnet contracts: adapter-level only (off-chain)

CCTP V2 and Uniswap V3 integrations are **off-chain TS adapters** in
`packages/routing-engine` (`adapters/bridge/cctpAdapter.ts`,
`adapters/dex/uniswapV3Adapter.ts`), driven by the protocol addresses in
`packages/config/src/mainnet.ts`. There are no custom Solidity contracts for
CCTP/Uniswap on mainnet, and `DepositReceiver` (a non-retaining settlement
target) stays testnet-only until a formal audit — real funds move only through
vetted, audited protocol contracts (Circle CCTP, Uniswap routers) via
sender-signed hop transactions. `packages/contracts` contains only the mock
DEX/bridge fixtures used by deterministic local tests.

## Repo layout (Turborepo 2 + pnpm)

```
apps/
  web/        # Vite + React widget host (Playwright + Synpress E2E)
  dashboard/  # Vite + React developer dashboard (port 5174)
  worker/     # BullMQ consumers: tx-monitor, bridge settlement, fallback, webhook dispatch
packages/
  api/        # NestJS REST server (auth, quotes, deposit intents, status, webhooks, screening)
  widget/     # React deposit widget (wagmi + viem)
  sdk/        # Headless TS client wrapping the API
  routing-engine/  # quote scoring, DEX/bridge adapters, fallback (the core IP)
  contracts/  # Foundry project: settlement receiver + local test fixtures
  db/         # Prisma schema, migrations, seed
  config/     # zod env schemas, chain/token registries
  tsconfig/   # shared TS configs
load/         # k6 load-test scripts
```

## Quickstart

Prereqs: Node 20+, pnpm 10, Foundry (forge/anvil), Docker.

```bash
pnpm install
docker compose up -d                      # Postgres + Redis
cp .env.example .env                       # defaults work for local dev

pnpm db:migrate                            # apply Prisma migrations
pnpm db:seed                               # creates a dev client + API key (printed once)

# Local chain + mock contracts (Anvil)
anvil --chain-id 31337 --port 8545 &       # or: pnpm --filter @paymesh/contracts run ... 
pnpm deploy:anvil                          # forge script: deploy mocks to Anvil

# Run the stack
pnpm dev:api                               # NestJS on :4000
pnpm dev:worker                            # job runner
pnpm dev:web                               # widget host on :5173
```

Seed output includes the API key and recipient id — put them in `apps/web/.env` (`VITE_API_KEY`, `VITE_RECIPIENT_ID`). For public-testnet execution, configure a real route provider in `ROUTE_PROVIDER_URLS`; the mock addresses below are local-fixture settings:

```
PAYMESH_DEX_ADDRESS=0x...                 # from deploy:anvil output
PAYMESH_BRIDGE_ADDRESS=0x...              # source-chain bridge
PAYMESH_DEST_CHAIN_ID=31338               # destination chain for 2-anvil tests
RELAYER_PRIVATE_KEY=0xac09...             # relayer for MockBridge settlement
```

## Testing

```bash
pnpm turbo run lint test test:contracts    # fast unit + Foundry + MSW/anvil tests
pnpm turbo run test:e2e                    # Docker-backed integration (API + worker settlement flows)
pnpm --filter @paymesh/web test:wallet     # gated Playwright + Synpress wallet E2E (full stack required)
```

Stack (PRD §16): Forge (unit/fuzz/invariant), Vitest + MSW, Testcontainers (Postgres/Redis), Supertest, @viem/anvil, Playwright + Synpress, Slither, k6.

Key test coverage:
- `packages/contracts` — `DepositReceiver` fuzz + invariant (never retains a balance), `MockDEX`/`MockBridge` failure injection.
- `packages/routing-engine` — MSW-mocked HTTP providers, scoring, fallback, on-chain swap/bridge quoting on two Anvils.
- `packages/api` — Supertest e2e: auth, idempotency, typed errors, screening, webhooks, settlement config (Testcontainers).
- `apps/worker` — full cross-chain settlement: swap → bridge → relayer settle → `deposit.settled` webhook; and fail → fallback → `deposit.failed` (Testcontainers + 2 Anvils).
- `apps/web` — Synpress MetaMask wallet E2E (gated).

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/deposit-intents` | Create a deposit intent (idempotent) |
| GET | `/v1/quote` | Best route + per-hop signable transactions |
| POST | `/v1/quote/:id/execute` | Server-custody sign+submit (optional) |
| POST | `/v1/quote/:id/transactions` | Report a sender-signed hop for monitoring |
| GET | `/v1/status?depositId=` | Poll deposit lifecycle |
| POST/DELETE | `/v1/webhooks` | Register/remove HMAC-signed webhooks |
| GET | `/v1/chains`, `/v1/tokens` | Supported networks/assets |
| PUT | `/v1/recipients/:id/settlement` | Update recipient settlement config |

Errors always return `{ error: { code, message, userMessage, details }, requestId }` — `userMessage` is safe to render in a UI.

## Non-custodial flow

1. **Widget** creates a deposit intent and quotes a route (`GET /quote`).
2. The route returns **one signable transaction per hop** (`hopTransactionRequests`).
3. The sender signs hop 0 (usually an ERC-20 approval), then the swap/bridge action, and reports each tx hash; the **worker** monitors them.
4. Each next hop is signed in turn. For a real provider, the worker waits for the recipient's destination balance to increase before marking the deposit settled; only local mock tests use the mock relayer.
5. Lifecycle events (`quote.ready`, `tx.submitted`, `tx.confirmed`, `deposit.settled`, `deposit.failed`) are HMAC-signed and delivered to registered webhooks.

## Deploy

- `ci.yml`: PR pipeline (typecheck, unit/Foundry tests, Docker-backed e2e, Slither, gated wallet E2E), staging hook on `main`.
- `deploy.yml`: tag-triggered production scaffold — wire Docker build/push + Terraform per §14/§21.
- Contracts deploy: `pnpm --filter @paymesh/contracts deploy:sepolia` (Foundry script, env-driven RPC + key).

## Notes / gotchas

- Amounts are stored as `Decimal(78,0)` strings (raw base units can exceed Postgres `bigint`).
- Public testnets require explicit RPC URLs and real provider/asset addresses; Anvil and the MockDEX/MockBridge stack are deterministic local fixtures, not a real bridge.
- For a real USDT → Polygon USDC flow, configure a verified source USDT token,
  a live Uniswap V3 router/quoter and pool, and CCTP V2. The flow is
  `USDT → Uniswap V3 → native Circle USDC → CCTP → Polygon Amoy USDC`.
  Keep `PAYMESH_ALLOW_MOCK_ROUTES=false`. LI.FI is optional.
- `@paymesh/tsconfig` must be a devDependency of any package that extends it (pnpm linking).
- Vitest transforms `src` with esbuild (no decorator metadata) — the API **e2e** suite runs against the tsc-compiled `dist`; unit tests run against `src`.
- Synpress 4.x changed its API (`testWithSynpress`/`defineWalletSetup` from the package root, `metaMaskFixtures`/`MetaMask` from `/playwright`); `playwright-core` is pinned via pnpm overrides.

---

*Build spec only — not legal or security advice. Get a real audit and legal review before real funds move through this.*
