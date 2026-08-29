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
  ALCHEMY_ARBITRUM_SEPOLIA_RPC: z.string().default(''),
  API_KEY_SECRET: z.string().default('dev-secret'),
  WEBHOOK_HMAC_SECRET: z.string().default('dev-webhook-secret'),
  RATE_LIMIT_TTL_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_LIMIT: z.coerce.number().default(300),
  SCREENING_DENY_LIST: z.string().default(''),
  TX_MONITOR_POLL_MS: z.coerce.number().default(1_500),
  TX_MONITOR_TIMEOUT_MS: z.coerce.number().default(120_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().default(5),
  EXECUTION_PRIVATE_KEY: z.string().default(''),
  RELAYER_PRIVATE_KEY: z.string().default(''),
  // On-chain routing defaults (anvil-local first, overridden after deploys)
  PAYMESH_SOURCE_CHAIN_ID: z.coerce.number().default(31337),
  PAYMESH_DEST_CHAIN_ID: z.coerce.number().default(84532),
  PAYMESH_DEX_ADDRESS: z.string().default(''),
  PAYMESH_BRIDGE_ADDRESS: z.string().default(''),
  PAYMESH_DEST_BRIDGE_ADDRESS: z.string().default(''),
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