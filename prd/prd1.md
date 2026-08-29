# PayMesh — Universal Deposit Layer
## Product Requirements Document & End-to-End Build Guide

*Working name: **PayMesh** (rename freely — every reference below is find/replace-able). This PRD specs a standalone product in the same category as Trustware/LI.FI/Socket/Rango: a non-custodial routing and settlement layer that lets a sender pay in any asset on any chain while the recipient gets exactly what they configured. No agent-specific layer — this is the core deposit-layer product only.*

---

## 1. Executive Summary

PayMesh is a non-custodial deposit and settlement layer. A payer sends whatever asset they already hold, on whatever chain they're on. PayMesh finds the best route (swap + bridge + swap), executes it, and delivers the recipient's chosen asset to the recipient's chosen destination — a wallet, a smart contract, or an exchange deposit address. PayMesh never takes custody of funds; every hop executes on-chain through existing DEX and bridge liquidity.

Three integration surfaces, all backed by the same routing core:
- **Widget** — drop-in React component for a hosted deposit UI.
- **Headless SDK** — same logic, unstyled, for teams that own their own UI.
- **REST API** — server-side integration for any backend, independent of a browser wallet.

This document covers problem framing, goals, personas, the full feature set, API and data model, architecture and sequence flows, error handling, compliance, a TurboRepo-based tech stack, a Sepolia-first testnet environment, a complete 2026-current testing stack, CI/CD, cost, roadmap, and a step-by-step build order.

---

## 2. Problem Statement

- **Fragmentation.** A merchant or app that wants "USDC on Base" has to reject or manually convert every other asset a payer might actually be holding.
- **Sender friction.** Payers are forced to hold the exact token on the exact chain the recipient expects, or go through a centralized exchange to convert first.
- **Build cost.** Doing this in-house means integrating multiple DEX aggregators, multiple bridges, tracking multi-chain transaction state, handling partial failures, and reconciling settlement — a multi-month effort most teams shouldn't be taking on themselves.

**Opportunity:** ship this as infrastructure. One integration point (widget, SDK, or API), and the routing/settlement problem disappears for every app that plugs in — the crypto equivalent of a payment gateway abstracting card networks.

---

## 3. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Universal acceptance | N chains / M tokens supported at launch (target: 3 EVM testnets → 5+ EVM mainnets in v1) |
| Reliable settlement | ≥99% of routed deposits settle successfully within 2 minutes |
| Non-custodial by design | Zero funds ever held in a PayMesh-controlled hot wallet at rest |
| Fast integration | A developer ships a working widget integration in under a day |
| Observability | 100% of deposits traceable end-to-end via a single status API / webhook |
| Uptime | 99.9% API uptime; alerting on any settlement SLA breach |

---

## 4. Personas

- **Human payer** — has a wallet (MetaMask, Rabby, WalletConnect), doesn't want to think about chains or bridges.
- **Merchant / recipient** — wants to configure "always settle to X asset at Y address" once and forget about it.
- **Developer / integrator** — wants an SDK or API that "just works," with good error messages and a status endpoint they can poll or subscribe to.

---

## 5. Scope

**In scope for MVP:** EVM-to-EVM routing on testnets (Sepolia + two Sepolia-family L2 testnets), same-chain swaps, cross-chain swap+bridge, dynamic settlement destinations (EOA, contract), widget + REST API, webhooks, basic AML screening hook, non-custodial execution.

**Explicitly out of scope for MVP** (defer to later phases): non-EVM chains (Solana, Bitcoin, Cosmos), fully gasless flows via paymaster, agent-specific identity/policy layer, mainnet deployment, formal audit.

---

## 6. Core Features

### 6.1 Universal Deposit Acceptance
Accept any supported token on any supported chain as the *source* of a deposit, regardless of what the recipient wants to receive.

### 6.2 Routing & Quoting Engine
Given `(fromChain, fromToken, fromAmount, toChain, toToken, toAddress)`, query DEX and bridge liquidity, score candidate routes on cost / time / slippage / reliability, and return the best route plus alternates. This is the core IP — everything else is plumbing around it.

### 6.3 Dynamic Settlement Configuration
Recipients define **where and how** they want to receive funds, independent of what the sender sent: an EOA, a smart contract call (e.g., deposit-into-vault), or a specific token on a specific chain. Changing the config takes effect on the next deposit — senders never need to know or care.

### 6.4 Non-Custodial Execution
PayMesh never becomes a custodian. The sender signs; execution happens through on-chain calls to routers, DEXs, and bridge contracts. If PayMesh's backend ever needs to co-sign (e.g., a relayed meta-transaction), it uses a KMS-backed signer scoped to a single relay action, never holding user funds.

### 6.5 Widget / Headless SDK / REST API
- **Widget:** `<PayMeshDeposit config={...} />` — wallet detection, quoting, and execution handled for you.
- **Headless SDK:** same `getQuote()` / `executeRoute()` primitives, no UI opinions.
- **REST API:** for server-side integrations and any custody/signing stack.

### 6.6 Webhooks & Status
Every deposit intent emits lifecycle events: `quote.ready`, `tx.submitted`, `deposit.settled`, `deposit.failed`. A `GET /status` endpoint supports polling as a fallback.

### 6.7 Security & Compliance Hooks
API-key auth, scoped permissions per integrator, transaction screening hook (pluggable — e.g., Chainalysis/TRM-style provider), audit logging on every config change and fund movement.

### 6.8 Observability
Structured logs with trace IDs from quote → settlement, metrics (quote latency, settlement time, failure rate by route), dashboards, and alerting on SLA breach.

---

## 7. System Architecture

```
                       ┌─────────────────────────┐
                       │        Clients          │
                       │  Widget · SDK · REST     │
                       └────────────┬─────────────┘
                                    │
                        ┌───────────▼────────────┐
                        │      API Gateway        │   (auth, rate limit)
                        └───────────┬────────────┘
                                    │
        ┌───────────────┬──────────┼──────────────┬────────────────┐
        ▼               ▼          ▼               ▼                ▼
 ┌────────────┐  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌───────────┐
 │  Deposit   │  │   Routing   │ │  Settlement  │ │  Webhook   │ │ Screening │
 │  Intent    │  │   Engine    │ │  Config      │ │  Dispatch  │ │  Hook     │
 │  Service   │  │(quote/score)│ │  Service     │ │  Service   │ │ (AML/KYT) │
 └─────┬──────┘  └──────┬──────┘ └──────┬───────┘ └─────┬──────┘ └─────┬─────┘
       │                │               │               │              │
       └────────────────┴───────┬───────┴───────────────┴──────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │   Postgres (state)     │
                     │   Redis / BullMQ (jobs)│
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │   Chain Watcher /      │
                     │   TX Monitor Worker    │
                     └───────────┬───────────┘
                                 ▼
        ┌────────────────────────────────────────────────┐
        │        On-chain: DEX routers · Bridges ·         │
        │        Recipient contracts (via RPC providers)   │
        └────────────────────────────────────────────────┘
```

The backend never sits *in* the money path — it quotes, coordinates, and watches. The actual value transfer is a transaction the sender signs and broadcasts (or a relayed tx funded by a paymaster the recipient configured, in later phases).

---

## 8. Data Model

| Entity | Key Fields | Notes |
|---|---|---|
| **Recipient** | `id`, `walletAddress`, `preferredChain`, `preferredToken`, `settlementType` (EOA/contract), `kycStatus` | One recipient can have multiple settlement configs |
| **DepositIntent** | `id`, `recipientId` (FK), `toChain`, `toToken`, `minAmount`, `maxAmount`, `status`, `createdAt` | Created before a sender pays; represents "what should happen" |
| **Quote** | `id`, `depositId` (FK), `fromChain`, `fromToken`, `fromAmount`, `routePath` (JSON hops), `estimatedFee`, `estimatedTime`, `outputAmount` | One deposit can have many quotes (re-quoted on expiry) |
| **Transaction** | `id`, `quoteId` (FK), `chainId`, `txHash`, `status`, `errorCode`, `submittedAt`, `confirmedAt` | One row per on-chain hop |
| **Chain** | `id`, `name`, `rpcUrl`, `explorerUrl` | Supported network registry |
| **Token** | `chainId`, `symbol`, `address`, `decimals` | Supported asset registry |
| **WebhookSubscription** | `clientId`, `url`, `events[]`, `secret` | HMAC-signed delivery |
| **ErrorLog** | `id`, `depositId`, `code`, `message`, `context` | For debugging and support |

Relationships: `Recipient 1—* DepositIntent`, `DepositIntent 1—* Quote`, `Quote 1—* Transaction`.

---

## 9. API Design

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/deposit-intents` | Create a deposit intent for a recipient |
| `GET` | `/v1/quote` | Get a route + signable transaction for a given source asset |
| `POST` | `/v1/quote/:id/execute` | (optional) single-call sign+submit for server-custody flows |
| `GET` | `/v1/status?depositId=` | Poll deposit status |
| `POST` | `/v1/webhooks` | Register a webhook subscription |
| `GET` | `/v1/chains`, `/v1/tokens` | List supported networks/assets |
| `PUT` | `/v1/recipients/:id/settlement` | Update a recipient's destination config |

Example:

```http
POST /v1/deposit-intents
{
  "recipientId": "merchant_77",
  "toChain": "84532",        // Base Sepolia
  "toToken": "0xUSDC...",
  "minAmount": "5000000"
}
→ { "depositId": "dep_abc123" }

GET /v1/quote?depositId=dep_abc123&fromChain=11155111&fromToken=native&fromAmount=1000000000000000000&fromAddress=0xSender
→ {
  "quoteId": "qt_xyz",
  "route": [ { "type": "swap", "chain": 11155111 }, { "type": "bridge", "from": 11155111, "to": 84532 } ],
  "estimatedOutput": "1980000",
  "estimatedTime": 95,
  "transactionRequest": { "to": "0xRouter...", "data": "0x...", "value": "1000000000000000000" }
}
```

All endpoints are JSON over HTTPS, authenticated via API key header, with a `userMessage` field on every error response for direct display to end users.

---

## 10. Core Flows

**Deposit flow (human, widget-driven):**
```
User → Widget: click "Deposit"
Widget → API: POST /deposit-intents
API → Widget: depositId
Widget → API: GET /quote (source asset picked by user)
API → Routing Engine: score routes across DEX/bridge liquidity
Routing Engine → API: best route + transactionRequest
Widget → User's Wallet: request signature
User's Wallet → Chain: broadcast tx
TX Monitor → Chain: watch for confirmation on each hop
TX Monitor → Webhook Service: emit deposit.settled
API → Widget: status = COMPLETED
```

**Failure/fallback flow:**
```
TX Monitor detects hop 2 (bridge) revert or timeout
→ Routing Engine: attempt fallback route (alternate bridge/DEX)
   if fallback succeeds → continue to settlement
   if no fallback available → mark DepositIntent FAILED
→ Webhook Service: emit deposit.failed { errorCode, message }
→ Recipient dashboard: surfaces as "needs attention"
```

---

## 11. Error Handling & Resilience

- **Typed error codes** (`ROUTE_NOT_FOUND`, `INSUFFICIENT_LIQUIDITY`, `BRIDGE_FAILED`, `SLIPPAGE_EXCEEDED`, `QUOTE_EXPIRED`) mapped to actionable, user-facing messages.
- **Automatic fallback routes** when a bridge or DEX leg fails, before surfacing failure to the user.
- **Idempotency keys** on deposit-intent creation so retries never double-process.
- **Per-hop transaction tracking** so a partial failure is visible (which leg succeeded, which didn't) rather than a single opaque "failed" status.
- **Alerting** when a specific route or bridge has an elevated failure rate — treat it as a systemic signal, not just per-transaction noise.

---

## 12. Compliance Considerations

- Pluggable transaction screening hook (Chainalysis/TRM-style) run against source and destination addresses before route execution.
- Deny-list for sanctioned jurisdictions/addresses, checked pre-quote.
- Transaction history export for recipients (for their own tax/accounting needs).
- Because PayMesh is non-custodial, it never holds funds at rest — this materially reduces (but does not eliminate) money-transmission exposure. **Get real legal review before mainnet launch; this PRD is not legal advice.**

---

## 13. Monitoring & SLAs

- Metrics: quotes/min, active deposits, failure rate by route/bridge, p50/p95 settlement time.
- Alerts: 5xx rate > 1%, any deposit stuck > 10 minutes, queue backlog growth.
- Dashboards: traffic, chain/asset volume mix, route health.
- Targets: 99.9% API uptime, 99% of deposits settled within 2 minutes.

---

## 14. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Shared types across API, SDK, widget, worker |
| API framework | NestJS | DI + modules suit a monorepo cleanly; Express is a lighter alternative if you want less structure |
| Database | PostgreSQL | Relational integrity for deposit/quote/tx state |
| Queue | BullMQ (Redis) | Background tx monitoring, retries, webhook delivery |
| Chain client | **viem** | TypeScript-native, tree-shakeable, strongly typed ABI inference — the current default over ethers.js v6 for new projects, especially if you'll ever add `wagmi` on the frontend |
| Frontend | React + **wagmi** (viem-based) + Tailwind | Wallet connection, chain switching, typed contract hooks |
| Contracts | Solidity, built with **Foundry** (primary) + **Hardhat 3** (deploy scripts / verification) | See §16 — this pairing is the 2026 standard |
| Key management | Turnkey (or equivalent KMS/HSM) | Only for the rare case of server-side relayed signing; never for holding user funds |
| Monorepo | **Turborepo 2.x** | Task graph + remote caching across all packages |
| Package manager | pnpm | Workspaces + fast installs, plays well with Turborepo |
| Infra | Docker + Terraform, deployed to AWS/GCP | IaC from day one |
| CI/CD | GitHub Actions | Turborepo-aware pipelines (see §17) |

### TurboRepo Structure

```
payrail/
├── apps/
│   ├── web/            # React widget host + docs site
│   └── worker/          # background job runner (BullMQ consumers)
├── packages/
│   ├── api/             # NestJS REST server
│   ├── widget/           # embeddable React component
│   ├── sdk/              # headless TS SDK (wraps API calls)
│   ├── routing-engine/   # quote scoring, DEX/bridge adapters
│   ├── contracts/        # Foundry project (Solidity)
│   ├── db/               # Prisma schema + client
│   ├── config/           # shared env schema, constants, chain/token registries
│   └── tsconfig/          # shared tsconfig bases
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

`turbo.json` (2.x syntax — the key is `tasks`, not the old `pipeline`):

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "test:contracts": { "cache": true, "outputs": ["contracts/coverage/**"] },
    "lint": { "dependsOn": ["^lint"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

---

## 15. Sepolia Testnet Environment

| Network | Chain ID | Purpose |
|---|---|---|
| Ethereum Sepolia | 11155111 | Primary source chain |
| Base Sepolia | 84532 | Primary destination chain |
| Arbitrum Sepolia | 421614 | Secondary chain for multi-hop routing tests |

**RPC:** Alchemy or Infura free-tier endpoints per chain (`ALCHEMY_SEPOLIA_RPC`, `ALCHEMY_BASE_SEPOLIA_RPC`, `ALCHEMY_ARBITRUM_SEPOLIA_RPC`).

**Faucets:** the Chainlink faucet and Alchemy's daily faucet both dispense Sepolia ETH; Base Sepolia and Arbitrum Sepolia ETH are available from their respective bridge faucets. Because faucet availability and amounts change, check current limits before relying on them for CI.

**Test assets:** deploy your own mock ERC-20 (`MockUSDC`, 6 decimals) on each testnet chain rather than depending on a faucet for stablecoins.

**Test liquidity:** deploy a minimal Uniswap V2-style pair contract (OpenZeppelin has reference implementations) for same-chain swap testing, and a `MockBridge` contract that simulates cross-chain transfer via a relayer script for bridge testing — real testnet bridge liquidity is unreliable, so don't build your integration tests around it being available.

**Wallets:** use Anvil's deterministic pre-funded accounts locally; use dedicated (never-reused) Sepolia dev wallets in CI, funded manually and topped up as needed.

---

## 16. Testing Stack (2026, current)

This is the part worth getting right — cross-chain routing has a lot of ways to fail quietly, and stale advice here (e.g. "just use Jest," "just use Hardhat") no longer reflects the current default toolchain.

| Layer | Tool | Why this one, now |
|---|---|---|
| **Contract unit + fuzz + invariant tests** | **Foundry (Forge)** | Solidity-native tests, by far the fastest compile/test loop, and the only mainstream option with built-in fuzzing and invariant testing — the standard for anything security-critical (routers, settlement contracts) |
| **Contract deploy scripts / verification / TS-side interop** | **Hardhat 3** | Keep Hardhat specifically for deployment scripts and Etherscan verification where TypeScript + viem/ethers integration matters. Foundry-for-tests + Hardhat-for-deploy is the standard hybrid, not a compromise |
| **Local chain / forking** | **Anvil** (ships with Foundry) | Fork Sepolia to simulate bridge/DEX state locally without spending testnet gas on every run; cheatcodes let you simulate reverts and reorgs deterministically |
| **Backend/API unit + integration tests** | **Vitest 4** | The 2026 default over Jest for new TypeScript projects — native ESM/TS via esbuild, no separate transform config, and Turborepo has documented native caching integration with Vitest so unaffected packages don't re-run |
| **Mocking external bridge/DEX HTTP APIs** | **MSW (Mock Service Worker)** | Intercepts fetch/HTTP at the network layer so routing-engine unit tests don't depend on live third-party liquidity APIs being up |
| **Ephemeral integration infra** | **Testcontainers** (Postgres + Redis) | Spin up real Postgres/Redis per CI run instead of mocking the DB — catches real query/migration bugs |
| **API contract tests** | **Supertest** (via Vitest) | In-process HTTP assertions against the NestJS app without a separate server process |
| **Frontend component tests** | **Vitest + React Testing Library** | Same runner as the backend — one config, one coverage report across the monorepo |
| **Browser E2E incl. wallet flows** | **Playwright** + **Synpress** | Playwright has overtaken Cypress for new projects (multi-browser, faster, better parallelism); Synpress extends Playwright specifically to automate MetaMask inside the browser context, which is what you need to E2E-test an actual deposit-and-sign flow |
| **Contract static analysis** | **Slither** | Fast static analysis, catches the classic reentrancy/access-control classes before you ever get to a paid audit |
| **Formal verification (stretch, pre-mainnet)** | **Halmos** or Certora | For the specific invariant that matters most — "this contract never retains a residual balance" — worth proving formally before real funds touch it |
| **Load testing** | **k6** | Script quote/execute load tests in JS, run in CI on a schedule, not just manually before launch |
| **Coverage** | `forge coverage` (contracts) + Vitest's built-in v8 coverage (TS) | Enforce a minimum threshold as a CI gate, not just a report nobody reads |

### Example: Foundry fuzz test (settlement contract)

```solidity
// packages/contracts/test/DepositReceiver.t.sol
function testFuzz_DepositEmitsCorrectAmount(uint256 amount) public {
    vm.assume(amount > 0 && amount < 1e30);
    mockToken.mint(sender, amount);
    vm.prank(sender);
    mockToken.approve(address(receiver), amount);

    vm.prank(sender);
    vm.expectEmit(true, false, false, true);
    emit DepositReceiver.Received(sender, amount, address(mockToken));
    receiver.deposit(address(mockToken), amount);

    assertEq(mockToken.balanceOf(address(receiver)), amount);
}
```

### Example: Vitest unit test with MSW mocking an external route provider

```ts
// packages/routing-engine/src/getQuote.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { getQuote } from './getQuote';

const server = setupServer(
  http.get('https://api.example-bridge.io/quote', () =>
    HttpResponse.json({ outputAmount: '1980000', fee: '0.003' })
  )
);
beforeAll(() => server.listen());
afterAll(() => server.close());

describe('getQuote', () => {
  it('selects the cheaper of two candidate routes', async () => {
    const quote = await getQuote({ fromChain: 11155111, toChain: 84532, amount: '1000000000000000000' });
    expect(quote.outputAmount).toBe('1980000');
  });
});
```

### Example: Playwright + Synpress E2E (widget deposit flow with MetaMask)

```ts
// apps/web/e2e/deposit.spec.ts
import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test('user completes a deposit through the widget', async ({ page, metamask }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await metamask.connectToDapp();
  await page.getByLabel('Amount').fill('0.01');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await metamask.confirmTransaction();
  await expect(page.getByText('Deposit Completed')).toBeVisible({ timeout: 60_000 });
});
```

### Test case matrix (minimum coverage before calling MVP "done")

- Same-chain swap only (no bridge hop)
- Cross-chain swap + bridge, happy path
- Bridge leg fails → fallback route succeeds
- Bridge leg fails → no fallback available → correctly marked FAILED, webhook fired
- Slippage exceeds tolerance → quote rejected before execution
- Quote expires before execution → forced re-quote
- Settlement to an EOA vs. settlement to a contract call
- Idempotent retry of the same deposit intent doesn't double-execute

---

## 17. CI/CD

GitHub Actions, Turborepo-orchestrated so unaffected packages skip re-testing:

```yaml
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - uses: foundry-rs/foundry-toolchain@v1
      - run: pnpm turbo run lint test test:contracts --filter=...[origin/main]
      - run: pnpm turbo run build
```

- Deploy to staging on merge to `main`; tag-triggered deploys to production.
- Contracts: deploy to Sepolia via a Hardhat/Foundry script, verify on Etherscan, only after `forge test` and Slither both pass in CI.
- Secrets (RPC keys, DB creds) in GitHub Actions secrets / a vault, never committed.

---

## 18. Security Checklist

- [ ] Every contract has Foundry unit + fuzz + invariant tests before any testnet deploy
- [ ] Slither run in CI on every PR touching `packages/contracts`
- [ ] No server-held private keys except a KMS-scoped relay signer (if used at all)
- [ ] API keys scoped per integrator, rotated on a schedule
- [ ] All webhook payloads HMAC-signed
- [ ] Rate limiting on every public endpoint
- [ ] Audit log on every settlement-config change and fund movement
- [ ] External audit before any mainnet deploy with real value

---

## 19. Roadmap

| Phase | Timeframe | Deliverables |
|---|---|---|
| **Design** | Weeks 1–2 | Freeze API spec, data model, turbo.json structure |
| **MVP** | Weeks 3–8 | Sepolia ↔ Base Sepolia routing, widget + REST API, webhooks, Foundry+Vitest test suites green in CI |
| **v1** | Weeks 9–16 | Add Arbitrum Sepolia, multi-token support, Playwright/Synpress E2E suite, Slither clean, pilot integrators onboarded |
| **Scale** | Weeks 17–24 | Mainnet audit, gasless/paymaster flow, performance tuning, launch |

---

## 20. Cost Estimate (pre-mainnet)

| Item | Est. Monthly |
|---|---|
| Cloud (staging + CI runners) | $200–500 |
| RPC providers (Alchemy/Infura, testnet) | $0–100 (free tiers usually sufficient) |
| Monitoring/logging | $100–300 |
| KMS (Turnkey or equivalent), if used | Usage-based, negligible pre-launch |
| **Total** | **Under $1k/month through MVP + v1** |

---

## 21. Build Order — Step by Step

1. **Scaffold the monorepo**
   ```bash
   pnpm dlx create-turbo@latest payrail
   cd payrail && pnpm install
   ```
2. **Set up `packages/contracts`** with Foundry:
   ```bash
   cd packages/contracts && forge init --no-commit
   forge install OpenZeppelin/openzeppelin-contracts
   ```
   Write `DepositReceiver.sol` + fuzz/invariant tests first — this is the piece real money eventually touches.
3. **Stand up `packages/db`** — Prisma schema for the entities in §8, migrate against a local Postgres (Testcontainers in CI).
4. **Build `packages/routing-engine`** — start with a single DEX + single bridge adapter, mocked via MSW in tests, before adding more liquidity sources.
5. **Build `packages/api`** (NestJS) — deposit-intents, quote, status endpoints first; webhooks after.
6. **Build `packages/sdk`** — thin wrapper over the API; this is also what the widget will consume internally.
7. **Build `packages/widget`** — wallet connect (wagmi) → quote → sign → status polling.
8. **Deploy contracts to Sepolia + Base Sepolia**, wire real RPC + faucet-funded dev wallets.
9. **Write the Playwright/Synpress E2E suite** against the deployed testnet contracts.
10. **Wire CI** (GitHub Actions + Turborepo filters) so every PR runs the full test matrix from §16 before merge.
11. **Add the second destination chain (Arbitrum Sepolia)** and a real fallback-route test case before calling MVP done.

---

## 22. Implementation Checklist

- [ ] API + data model frozen
- [ ] Foundry contracts + fuzz tests passing
- [ ] Routing engine returns a real quote for at least one DEX + one bridge
- [ ] Widget completes a full deposit on Sepolia → Base Sepolia
- [ ] Webhooks fire correctly on settle and on fail
- [ ] Vitest + Foundry + Playwright/Synpress all green in CI, gated on merge
- [ ] Slither clean on contracts
- [ ] Monitoring dashboards live before onboarding first pilot integrator
- [ ] Legal review of the compliance section before any mainnet/real-value deploy

---

*This document is a build spec, not legal or security advice — get a real audit and real legal review before real funds move through any of this.*