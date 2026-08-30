# PayMesh three-chain testnet plan

## Target flow

PayMesh supports one controlled pilot topology:

```text
Ethereum Sepolia (11155111) ─┐
                              ├─> Polygon Amoy (80002)
Base Sepolia (84532) ────────┘       settlement
```

The payer signs transactions on the source chain. The recipient always receives Circle testnet USDC on Polygon Amoy (`0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`).

## End-to-end build order

1. Register Sepolia, Base Sepolia, and Polygon Amoy in the chain registry.
2. Configure one RPC endpoint per chain.
3. Configure real source assets and a real route provider (or a deployed
   Uniswap V3 router/quoter plus CCTP V2). Mock contracts are
   local/test fixtures only and must not be confused with Circle USDC.
4. Configure the provider's executable transaction API in `ROUTE_PROVIDER_URLS`.
5. Create a recipient whose destination is Polygon Amoy USDC.
7. Start Postgres, Redis, API, worker, and web widget.
8. Connect a wallet on Sepolia or Base Sepolia.
9. Request a quote, sign each source-chain hop, and report each transaction hash.
10. Let the worker confirm the source transaction, observe destination USDC
    balance growth, and emit `deposit.settled`.
11. Verify the recipient balance and every transaction in the status endpoint.

The route decision is made by `RouteHandler`; it does not depend on a specific
bridge. For the MVP, Uniswap V3 swaps source USDT into native Circle USDC and
CCTP V2 bridges that USDC to Polygon Amoy. LI.FI, Across, Stargate, or another
provider can be supplied later as separate adapters.

## Required acceptance tests

- Sepolia → Polygon Amoy happy path.
- Base Sepolia → Polygon Amoy happy path.
- Unsupported source chain rejected.
- Any destination other than Polygon Amoy rejected.
- Quote expires before signing.
- Source transaction reverts and fallback/failure event is emitted.
- Duplicate intent request with the same idempotency key does not create a second deposit.
- Webhook signature and status endpoint agree on the final state.

## Testnet environment

Configure the following values after deployments:

```env
ALCHEMY_SEPOLIA_RPC=https://...
ALCHEMY_BASE_SEPOLIA_RPC=https://...
POLYGON_AMOY_RPC=https://...
PAYMESH_DEST_CHAIN_ID=80002
PAYMESH_SEPOLIA_DEX_ADDRESS=0x...
PAYMESH_SEPOLIA_BRIDGE_ADDRESS=0x...
PAYMESH_BASE_SEPOLIA_DEX_ADDRESS=0x...
PAYMESH_BASE_SEPOLIA_BRIDGE_ADDRESS=0x...
PAYMESH_DEST_BRIDGE_ADDRESS=0x...
LIFI_ENABLED=true
LIFI_API_URL=https://li.quest/v1
LIFI_API_KEY=
LIFI_INTEGRATOR=paymesh
PAYMESH_ALLOW_MOCK_ROUTES=false
PAYMESH_SEPOLIA_USDT_ADDRESS=0x...
PAYMESH_BASE_SEPOLIA_USDT_ADDRESS=0x...
POLYGON_AMOY_USDC_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...
```

The repository still includes mock DEX/bridge contracts for deterministic local
tests, but they are not a real bridge and do not move Circle USDC. Before a
public-testnet happy path can settle real value, configure the real Uniswap V3
and CCTP adapters with executable transactions. For USDT → USDC, Uniswap must
also have a live pool and enough liquidity for the exact token addresses
liquidity for the exact token addresses configured on that source chain.
