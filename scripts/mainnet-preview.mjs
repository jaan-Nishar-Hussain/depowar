// Mainnet-safe route preview + dry-run execution canary.
//
// This script is deliberately SAFE BY DEFAULT:
//   - It NEVER broadcasts a transaction unless you pass --confirm-live (which
//     additionally requires APP_ENV=production).
//   - Without that flag it only QUOTES and SIMULATES (`eth_call`) the best
//     route and prints the exact transactions that WOULD be broadcast.
//
// Usage:
//   node scripts/mainnet-preview.mjs \
//     --fromChain 1 --fromToken USDT --fromAmount 10 \
//     --toChain 8453 --toToken USDC --recipient 0xYourWallet
//   node scripts/mainnet-preview.mjs ... --confirm-live     # ⚠️ broadcasts real funds

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getToken, loadEnv } from '@paymesh/config';
import {
  createDefaultAdapters,
  createRouteApiAdapter,
  createLifiRouteProvider,
  RouteHandler,
  getSharedTelemetryStore,
} from '@paymesh/routing-engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });
const env = loadEnv();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const value = args[i + 1];
      result[arg.slice(2)] = value !== undefined && !value.startsWith('--') ? value : 'true';
    }
  }
  return result;
}

const SUPPORTED = [1, 8453, 42161, 10, 137, 43114, 56, 59144];

function mainnetRpcFor(chainId) {
  const map = {
    1: env.ETHEREUM_MAINNET_RPC,
    8453: env.BASE_MAINNET_RPC,
    137: env.POLYGON_MAINNET_RPC,
    43114: env.AVALANCHE_MAINNET_RPC,
    42161: env.ARBITRUM_MAINNET_RPC,
    10: env.OPTIMISM_MAINNET_RPC,
    59144: env.LINEA_MAINNET_RPC,
    56: 'https://bsc-dataseed.bnbchain.org',
  };
  return map[chainId] ?? '';
async function main() {
  const args = parseArgs();
  const fromChain = Number(args.fromChain ?? '0');
  const toChain = Number(args.toChain ?? '0');
  const fromToken = args.fromToken;
  const toToken = args.toToken ?? 'USDC';
  const amount = args.fromAmount;
  const recipient = args.recipient;
  const confirmLive = args['confirm-live'] === 'true';

  if (!SUPPORTED.includes(fromChain) || !SUPPORTED.includes(toChain)) {
    console.error(`Unsupported chain pair (${fromChain} → ${toChain}). Supported: ${SUPPORTED.join(', ')}`);
    process.exit(1);
  }
  if (!fromToken || !amount || !recipient) {
    console.error('Usage: node scripts/mainnet-preview.mjs --fromChain 1 --fromToken USDT --fromAmount 10 --toChain 8453 --toToken USDC --recipient 0x... [--confirm-live]');
    process.exit(1);
  }
  if (confirmLive) {
    // Real-money moves: hard requirement to acknowledge in the env AND pass the flag.
    if (env.APP_ENV !== 'production') {
      console.error('--confirm-live requires APP_ENV=production (real-funds guard). Aborting.');
      process.exit(1);
    }
    console.error('⚠️  CONFIRMED LIVE EXECUTION — real funds will move. Ctrl-C within 10s to abort.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const sourceTokenAddr = getToken(fromChain, fromToken)?.address;
  const destTokenAddr = getToken(toChain, toToken)?.address ?? getToken(toChain, 'USDC')?.address;
  if (!sourceTokenAddr || !destTokenAddr) {
    console.error(`Unknown token ${fromToken}/${toToken} on chain registry.`);
    process.exit(1);
  }
  const sourceAmount = BigInt(amount) * 10n ** 6n; // USDC/USDT are 6 decimals.

  const rpc = mainnetRpcFor(fromChain);
  if (!rpc) {
    console.error(`No RPC configured for chain ${fromChain}.`);
    process.exit(1);
  }

  const adapters = createDefaultAdapters({
    rpcUrl: rpc,
    sourceChainId: fromChain,
    destChainId: toChain,
    cctpEnabled: env.CCTP_ENABLED,
    allowMock: false,
    env,
  });

  const routeProviders = [
    ...(env.ROUTE_PROVIDER_URLS
      ? env.ROUTE_PROVIDER_URLS.split(',').map((url) => url.trim()).filter(Boolean).map((baseUrl) => createRouteApiAdapter({ baseUrl, timeoutMs: env.ROUTE_PROVIDER_TIMEOUT_MS }))
      : []),
    ...(env.LIFI_ENABLED
      ? [createLifiRouteProvider({
          baseUrl: env.LIFI_API_URL,
          apiKey: env.LIFI_API_KEY || undefined,
          integrator: env.LIFI_INTEGRATOR,
          timeoutMs: env.ROUTE_PROVIDER_TIMEOUT_MS,
        })]
      : []),
  ];

  const baseRequest = {
    fromChain,
    fromToken: sourceTokenAddr,
    fromAmount: sourceAmount,
    toChain,
    toToken: destTokenAddr,
    toAddress: recipient,
  };
// Quote (non-custodial: quoting needs no wallet key).
  const handler = new RouteHandler({
    dependencies: {
      swapAdapters: adapters.swapAdapters,
      bridgeAdapters: adapters.bridgeAdapters,
      routeProviders,
      telemetry: getSharedTelemetryStore().snapshot(),
    },
  });
  const { best, alternates } = await handler.findBestRoute(baseRequest);

  console.log('\n=== Best route ===');
  console.log(`adapter:           ${best.adapterId}`);
  console.log(`output:            ${best.estimatedOutput.toString()}`);
  console.log(`estimated fee:     ${best.estimatedFee.toString()}`);
  console.log(`est. time:         ${best.estimatedTimeSeconds}s`);
  console.log(`reliability:       ${best.reliability}`);
  for (const hop of best.route) {
    console.log(`- ${hop.type} ${hop.protocol ?? ''} ${hop.fromToken ?? ''} → ${hop.toToken ?? ''} (${hop.amountIn?.toString() ?? ''} → ${hop.amountOut?.toString() ?? ''})`);
  }
  console.log('\n=== Signable transactions (DRY-RUN; nothing broadcast) ===');
  (best.hopTransactionRequests ?? []).forEach((tx, i) => {
    const hop = best.route[i];
    console.log(`#${i} [${hop?.type ?? '?'}] to=${tx.to} chain=${tx.chainId ?? '?'} value=${tx.value.toString()}`);
    console.log(`   data=${tx.data.slice(0, 80)}${tx.data.length > 80 ? '…' : ''}`);
  });
  if (alternates.length) {
    console.log(`\n=== Alternates (${alternates.length}) ===`);
    for (const alt of alternates) {
      console.log(`- ${alt.adapterId}: output=${alt.estimatedOutput.toString()} fee=${alt.estimatedFee.toString()} time=${alt.estimatedTimeSeconds}s`);
    }
  }

  // Simulate the first hop against the live chain (stateless eth_call).
  const publicClient = createPublicClient({
    chain: { id: fromChain, name: `chain-${fromChain}`, rpcUrls: { default: { http: [rpc] } } },
    transport: http(rpc),
  });
  const first = best.transactionRequest;
  if (first) {
    try {
      const result = await publicClient.call({
        account: best.hopTransactionRequests?.[0]?.from,
        to: first.to,
        data: first.data,
        value: first.value,
      });
      console.log(`\neth_call simulation: OK (${result.gas ? `gas ${result.gas}` : 'no revert'})`);
    } catch (error) {
      console.error(`\neth_call simulation FAILED: ${error.message}`);
      if (!confirmLive) process.exit(2);
    }
  }

  if (!confirmLive) {
    console.log('\n✅ Preview complete — nothing broadcast. Re-run with --confirm-live to execute (real funds!).');
    return;
  }

  // Live execution: requires APP_ENV=production + --confirm-live + funded relayer.
  const priv = env.RELAYER_PRIVATE_KEY;
  if (!priv) {
    console.error('RELAYER_PRIVATE_KEY is required for --confirm-live execution.');
    process.exit(1);
  }
  if (!best.hopTransactionRequests?.length) {
    console.error('No signable transactions returned; cannot execute.');
    process.exit(1);
  }
  const account = privateKeyToAccount(priv);
  const chainDef = { id: fromChain, name: `chain-${fromChain}`, rpcUrls: { default: { http: [rpc] } } };
  const walletClient = createWalletClient({ account, chain: chainDef, transport: http(rpc) });
  for (let i = 0; i < best.hopTransactionRequests.length; i++) {
    const tx = best.hopTransactionRequests[i];
    const hash = await walletClient.sendTransaction({
      to: tx.to, data: tx.data, value: tx.value,
      chain: { id: tx.chainId ?? fromChain, name: `chain-${tx.chainId ?? fromChain}`, rpcUrls: { default: { http: [rpc] } } },
    });
    console.log(`Broadcast hop ${i}: ${hash}`);
  }
  console.log('⚠️  Route broadcast. Monitor settlement on-chain. This is experimental tooling — verify delivery.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
}