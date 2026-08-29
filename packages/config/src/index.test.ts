import { describe, it, expect, afterEach } from 'vitest';
import { loadEnv, resetEnv, getChain, listChains, getTokens, DEFAULT_SLIPPAGE_BPS } from '../src';

afterEach(() => resetEnv());

describe('env', () => {
  it('applies defaults when no env is set', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.APP_ENV).toBe('development');
    expect(env.DATABASE_URL).toContain('localhost');
  });

  it('coerces numeric values', () => {
    const env = loadEnv({ PORT: '8080' as unknown as number, RATE_LIMIT_LIMIT: '100' as unknown as number });
    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_LIMIT).toBe(100);
  });
});

describe('chains', () => {
  it('registers the three Sepolia-family testnets plus Anvil', () => {
    loadEnv({});
    expect(listChains().map((c) => c.id)).toEqual(expect.arrayContaining([31337, 11155111, 84532, 421614]));
  });

  it('defaults testnet RPCs to the local anvil URL', () => {
    loadEnv({ ANVIL_RPC_URL: 'http://127.0.0.1:8545', ALCHEMY_SEPOLIA_RPC: '' });
    expect(getChain(11155111).rpcUrl).toBe('http://127.0.0.1:8545');
  });

  it('uses the real testnet RPC when configured', () => {
    loadEnv({ ALCHEMY_SEPOLIA_RPC: 'https://eth-sepolia.example.com' });
    expect(getChain(11155111).rpcUrl).toBe('https://eth-sepolia.example.com');
  });

  it('throws for unknown chains', () => {
    expect(() => getChain(999)).toThrow();
  });
});

describe('tokens', () => {
  it('returns native + USDC + WETH on every chain', () => {
    for (const id of [31337, 11155111, 84532, 421614]) {
      const symbols = getTokens(id).map((t) => t.symbol);
      expect(symbols).toEqual(expect.arrayContaining(['ETH', 'USDC', 'WETH']));
    }
  });

  it('exposes a default slippage tolerance', () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBeGreaterThan(0);
  });
});