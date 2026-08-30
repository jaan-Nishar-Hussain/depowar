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
  API_KEY_SECRET: z.string().default('dev-secret'),
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
  EXECUTION_PRIVATE_KEY: z.string().default(''),
  SEPOLIA_PRIVATE_KEY: z.string().default(''),
  BASE_SEPOLIA_PRIVATE_KEY: z.string().default(''),
  POLYGON_AMOY_PRIVATE_KEY: z.string().default(''),
  RELAYER_PRIVATE_KEY: z.string().default(''),
  // On-chain routing defaults (anvil-local first, overridden after deploys)
  PAYMESH_SOURCE_CHAIN_ID: z.coerce.number().default(31337),
  PAYMESH_DEST_CHAIN_ID: z.coerce.number().default(80002),
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
  CCTP_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  CCTP_SEPOLIA_TOKEN_MESSENGER_ADDRESS: z.string().default(''),
  CCTP_BASE_SEPOLIA_TOKEN_MESSENGER_ADDRESS: z.string().default(''),
  CCTP_POLYGON_AMOY_MESSAGE_TRANSMITTER_ADDRESS: z.string().default(''),
  CCTP_IRIS_API_URL: z.string().default('https://iris-api-sandbox.circle.com'),
  CCTP_ATTESTATION_POLL_MS: z.coerce.number().default(5_000),
  CCTP_ATTESTATION_TIMEOUT_MS: z.coerce.number().default(1_200_000),
  CCTP_MAX_FEE: z.coerce.bigint().default(0n),
  CCTP_MIN_FINALITY_THRESHOLD: z.coerce.number().default(2000),
  ROUTE_PROVIDER_URLS: z.string().default(''),
  ROUTE_PROVIDER_TIMEOUT_MS: z.coerce.number().default(5_000),
  LIFI_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
    z.boolean(),
  ).default(false),
  LIFI_API_URL: z.string().default('https://li.quest/v1'),
  LIFI_API_KEY: z.string().default(''),
  LIFI_INTEGRATOR: z.string().default('paymesh'),
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
  return cached;
}

export function getEnv(): AppEnv {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export function resetEnv(): void {
  cached = undefined;
}
