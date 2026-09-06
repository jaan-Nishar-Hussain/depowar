import { z } from 'zod';

const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().default('postgresql://paymesh:paymesh@localhost:5432/paymesh'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ANVIL_RPC_URL: z.string().default('http://127.0.0.1:8545'),
  ANVIL_CHAIN_ID: z.coerce.number().default(31337),
  ANVIL_B_RPC_URL: z.string().default('http://127.0.0.1:8546'),
  ALCHEMY_SEPOLIA_RPC: z.string().default(''),
  ALCHEMY_BASE_SEPOLIA_RPC: z.string().default(''),
  BASE_SEPOLIA_RPC: z.string().default('https://sepolia.base.org'),
  ALCHEMY_ARBITRUM_SEPOLIA_RPC: z.string().default(''),
  INFURA_SEPOLIA_RPC: z.string().default(''),
  POLYGON_AMOY_RPC: z.string().default(''),
  // Mainnet RPCs. Keep these separate from testnet credentials.
  ETHEREUM_MAINNET_RPC: z.string().default('https://ethereum-rpc.publicnode.com'),
  BASE_MAINNET_RPC: z.string().default('https://mainnet.base.org'),
  POLYGON_MAINNET_RPC: z.string().default('https://polygon-rpc.com'),
  AVALANCHE_MAINNET_RPC: z.string().default('https://api.avax.network/ext/bc/C/rpc'),
  ARBITRUM_MAINNET_RPC: z.string().default('https://arb1.arbitrum.io/rpc'),
  OPTIMISM_MAINNET_RPC: z.string().default('https://mainnet.optimism.io'),
  LINEA_MAINNET_RPC: z.string().default('https://rpc.linea.build'),
  MONAD_MAINNET_RPC: z.string().default('https://rpc.monad.xyz'),
  BNB_MAINNET_RPC: z.string().default('https://bsc-dataseed.binance.org'),
  ZKSYNC_MAINNET_RPC: z.string().default('https://mainnet.era.zksync.io'),
  API_KEY_SECRET: z.string().default('dev-secret'),
  AUTH_JWT_SECRET: z.string().default('dev-auth-secret-change-me'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/v1/auth/google/callback'),
  DASHBOARD_URL: z.string().default('http://localhost:5174'),
  WEBHOOK_HMAC_SECRET: z.string().default('dev-webhook-secret'),
  RATE_LIMIT_TTL_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_LIMIT: z.coerce.number().default(300),
  SCREENING_DENY_LIST: z.string().default(''),
  TX_MONITOR_POLL_MS: z.coerce.number().default(1_500),
  TX_MONITOR_TIMEOUT_MS: z.coerce.number().default(120_000),
  TX_VALIDATION_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(true),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().default(5),
  // Fallback-route orchestration guards (PRD §Fallback Safety: no infinite
  // loops). FALLBACK_MAX_DEPTH caps how many chained fallback re-quotes a
  // single deposit may attempt before it is marked FAILED.
  FALLBACK_MAX_DEPTH: z.coerce.number().default(3),
  // How many times the fallback-route job itself retries on transient failure.
  FALLBACK_QUEUE_ATTEMPTS: z.coerce.number().default(5),
  // Periodic re-enqueue interval for SETTLEMENT_PENDING rows (ms). The
  // boot-only recovery sweep is not enough: a worker restart or a long
  // attestation must not strand an in-flight burn.
  RECOVERY_SWEEP_INTERVAL_MS: z.coerce.number().default(300_000),
  // How often the worker recomputes the daily AnalyticsDaily rollups (ms).
  ANALYTICS_ROLLUP_INTERVAL_MS: z.coerce.number().default(3_600_000),
  EXECUTION_PRIVATE_KEY: z.string().default(''),
  SEPOLIA_PRIVATE_KEY: z.string().default(''),
  BASE_SEPOLIA_PRIVATE_KEY: z.string().default(''),
  POLYGON_AMOY_PRIVATE_KEY: z.string().default(''),
  RELAYER_PRIVATE_KEY: z.string().default(''),
  // On-chain routing defaults (anvil-local first, overridden after deploys)
  PAYMESH_SOURCE_CHAIN_ID: z.coerce.number().default(31337),
  PAYMESH_DEST_CHAIN_ID: z.coerce.number().default(80002),
  // Comma-separated destination allowlist. Empty preserves the legacy single
  // destination setting above. Example: 137,42161,8453
  PAYMESH_DEST_CHAIN_IDS: z.string().default(''),
  // Simulates the best candidate's first transaction (`eth_call`) before a
  // quote is returned (PRD §simulate before you commit).
  SIMULATE_QUOTES: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(true),
  PAYMESH_DEX_ADDRESS: z.string().default(''),
  PAYMESH_BRIDGE_ADDRESS: z.string().default(''),
  PAYMESH_DEST_BRIDGE_ADDRESS: z.string().default(''),
  PAYMESH_WETH_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_DEX_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_BRIDGE_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_DEX_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_BRIDGE_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_DEX_ROUTER_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_DEX_ROUTER_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_UNISWAP_V3_ROUTER_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_USDT_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_USDT_ADDRESS: z.string().default(''),
  PAYMESH_SEPOLIA_WETH_ADDRESS: z.string().default(''),
  PAYMESH_BASE_SEPOLIA_WETH_ADDRESS: z.string().default(''),
  POLYGON_AMOY_USDC_ADDRESS: z.string().default(''),
  ETHEREUM_MAINNET_PRIVATE_KEY: z.string().default(''),
  BASE_MAINNET_PRIVATE_KEY: z.string().default(''),
  POLYGON_MAINNET_PRIVATE_KEY: z.string().default(''),
  PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS: z.string().default('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
  PAYMESH_ETHEREUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS: z.string().default('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  PAYMESH_BASE_MAINNET_UNISWAP_V3_ROUTER_ADDRESS: z.string().default('0x2626664c2603336E57B271c5C0b26F421741e481'),
  PAYMESH_BASE_MAINNET_UNISWAP_V3_QUOTER_ADDRESS: z.string().default('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'),
  PAYMESH_POLYGON_MAINNET_UNISWAP_V3_ROUTER_ADDRESS: z.string().default('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
  PAYMESH_POLYGON_MAINNET_UNISWAP_V3_QUOTER_ADDRESS: z.string().default('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  // Arbitrum and Optimism share Uniswap Labs' canonical SwapRouter (v1) +
  // QuoterV2 addresses with Ethereum/Polygon (verified against
  // developers.uniswap.org/docs/protocols/v3/deployments, Sept 2026).
  // Avalanche and Monad only have SwapRouter02 deployed (a different ABI
  // than this codebase's adapter expects), and Linea has no official
  // Uniswap v3 deployment at all — none of those three get a default here.
  PAYMESH_ARBITRUM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS: z.string().default('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
  PAYMESH_ARBITRUM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS: z.string().default('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  PAYMESH_OPTIMISM_MAINNET_UNISWAP_V3_ROUTER_ADDRESS: z.string().default('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
  PAYMESH_OPTIMISM_MAINNET_UNISWAP_V3_QUOTER_ADDRESS: z.string().default('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  CCTP_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS: z.string().default(''),
  CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS: z.string().default(''),
  CCTP_POLYGON_AMOY_MESSAGE_TRANSMITTER_ADDRESS: z.string().default(''),
  CCTP_ETHEREUM_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_BASE_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_POLYGON_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_ETHEREUM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_BASE_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_POLYGON_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  // CCTP V2 deploys TokenMessengerV2/MessageTransmitterV2 at the same address
  // on every supported EVM chain (verified against
  // developers.circle.com/cctp/references/contract-addresses, Sept 2026).
  // Native USDC bridging works on these chains even where a Uniswap V3 swap
  // leg is not available (Avalanche, Monad) or unverified (Linea).
  CCTP_ARBITRUM_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_ARBITRUM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_OPTIMISM_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_OPTIMISM_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_AVALANCHE_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_AVALANCHE_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_LINEA_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_LINEA_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_MONAD_MAINNET_TOKEN_MESSENGER_ADDRESS: z.string().default('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  CCTP_MONAD_MAINNET_MESSAGE_TRANSMITTER_ADDRESS: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  CCTP_IRIS_API_URL: z.string().default('https://iris-api-sandbox.circle.com'),
  CCTP_MAX_FEE: z.coerce.bigint().default(0n),
  CCTP_MIN_FINALITY_THRESHOLD: z.coerce.number().default(2000),
  ROUTE_PROVIDER_URLS: z.string().default(''),
  // Advanced cross-chain providers may need one request for route discovery
  // and another for transaction preparation.
  ROUTE_PROVIDER_TIMEOUT_MS: z.coerce.number().default(30_000),
  LIFI_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  LIFI_API_URL: z.string().default('https://li.quest/v1'),
  LIFI_API_KEY: z.string().default(''),
  LIFI_INTEGRATOR: z.string().default('paymesh'),
  // Tier-2 DEX aggregator: 1inch (PRD §Priority Provider List).
  ONEINCH_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  ONEINCH_API_URL: z.string().default('https://api.1inch.dev'),
  ONEINCH_API_KEY: z.string().default(''),
  ONEINCH_ROUTER_ADDRESS: z.string().default('0x111111125421cA6dc452d289314280a0f8842A65'),
  // Tier-1 intent bridge: Across. Mainnet-only; enabling on testnets is a no-op.
  ACROSS_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  ACROSS_API_URL: z.string().default('https://api.across.to'),
  ACROSS_INTEGRATOR_ID: z.string().default(''),
  ACROSS_API_KEY: z.string().default(''),
  // Backup rail: Chainlink CCIP. Router/selector pairs are formatted as
  // "<chainId>:<routerAddress>:<sourceSelector>:<destSelector>" separated by
  // commas, plus the carry token per source chain "<chainId>:<token>".
  CCIP_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  CCIP_ROUTERS: z.string().default(''),
  CCIP_TOKEN: z.string().default(''),
  PAYMESH_ALLOW_MOCK_ROUTES: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  ANVIL_ACCOUNT_PRIVATE_KEY: z.string().default(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

/**
 * Parses process.env with defaults. Pass `overrides` (typically from tests)
 * to inject specific values without touching the process environment.
 */
export function loadEnv(overrides?: Partial<AppEnv>): AppEnv {
  const source = { ...process.env, ...(overrides ?? {}) };
  cached = EnvSchema.parse(source);
  if (cached.APP_ENV === 'production') {
    if (cached.PAYMESH_ALLOW_MOCK_ROUTES) {
      throw new Error('PAYMESH_ALLOW_MOCK_ROUTES must be false in production');
    }
    if ([31337, 80002, 84532, 11155111].includes(cached.PAYMESH_DEST_CHAIN_ID)) {
      throw new Error('Production settlement must target a mainnet chain');
    }
    if (cached.CCTP_ENABLED && cached.CCTP_IRIS_API_URL.includes('sandbox')) {
      throw new Error('Production CCTP must use https://iris-api.circle.com');
    }
  }
  return cached;
}

export function getEnv(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

/**
 * Returns the destinations an integrator may request. The allowlist is kept
 * server-side so a client cannot route funds to an arbitrary chain; the
 * selected chain still comes from each deposit intent's `toChain` field.
 */
export function getDestinationChainIds(env: AppEnv = getEnv()): number[] {
  const configured = env.PAYMESH_DEST_CHAIN_IDS
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(configured.length > 0 ? configured : [env.PAYMESH_DEST_CHAIN_ID])];
}

export function resetEnv(): void {
  cached = undefined;
}

/** Parsed CCIP router configuration for one source chain. */
export interface CcipRouterConfig {
  routerAddress: string;
  sourceChainSelector: bigint;
  destinationChainSelector: bigint;
  destinationChainId: number;
  token: string;
}

/**
 * Parses CCIP_ROUTERS entries of the form
 * "<chainId>:<router>:<sourceSelector>:<destSelector>:<destChainId>" and
 * CCIP_TOKEN entries of "<chainId>:<token>". Returns [] when unconfigured.
 */
export function ccipRouterConfigs(env: AppEnv = getEnv()): CcipRouterConfig[] {
  if (!env.CCIP_ENABLED) return [];
  const tokens = new Map<number, string>();
  for (const entry of env.CCIP_TOKEN.split(',')) {
    const parts = entry.split(':').map((p) => p.trim());
    const [chainRaw, token] = parts;
    if (chainRaw && token) tokens.set(Number(chainRaw), token);
  }
  const configs: CcipRouterConfig[] = [];
  for (const entry of env.CCIP_ROUTERS.split(',')) {
    const parts = entry.split(':').map((value) => value.trim());
    if (parts.length !== 5) continue;
    const [chainRaw, router, sourceSelector, destSelector, destChain] = parts;
    const chainId = Number(chainRaw);
    const token = tokens.get(chainId);
    if (!Number.isInteger(chainId) || !router || !sourceSelector || !destSelector || !destChain || !token) continue;
    configs.push({
      routerAddress: router,
      sourceChainSelector: BigInt(sourceSelector),
      destinationChainSelector: BigInt(destSelector),
      destinationChainId: Number(destChain),
      token,
    });
  }
  return configs;
}
