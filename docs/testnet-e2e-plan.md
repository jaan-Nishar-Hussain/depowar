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
3. Deploy the controlled testnet contracts on each required network:
   - source-side MockDEX on Sepolia and Base Sepolia;
   - source-side MockBridge on Sepolia and Base Sepolia;
   - destination-side MockBridge and test settlement token on Polygon Amoy.
4. Seed source DEX liquidity and destination bridge liquidity.
5. Configure separate source contract addresses in `.env`.
6. Create a recipient whose destination is Polygon Amoy and whose token is the Polygon Amoy test token.
7. Start Postgres, Redis, API, worker, and web widget.
8. Connect a wallet on Sepolia or Base Sepolia.
9. Request a quote, sign each source-chain hop, and report each transaction hash.
10. Let the worker confirm the source transaction, relay the mock bridge settlement on Polygon Amoy, and emit `deposit.settled`.
11. Verify the recipient balance and every transaction in the status endpoint.

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
POLYGON_AMOY_USDC_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...
```

This first milestone uses the repository's mock DEX/bridge contracts for deterministic testnet validation. The initial executable asset path is ERC-20 USDC; native ETH/POL input requires a wrapping/native-token adapter. A production bridge adapter must replace the mock settlement trust model before real funds are used.
