import { describe, it, expect, afterEach } from 'vitest';
import { loadEnv, resetEnv, getChain, listChains, getToken, getTokens, DEFAULT_SLIPPAGE_BPS } from '../src';

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
    expect(listChains().map((c) => c.id)).toEqual(expect.arrayContaining([31337, 11155111, 84532, 80002]));
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

  it('registers the mainnet canary chains', () => {
    loadEnv({
      ETHEREUM_MAINNET_RPC: 'https://eth.example',
      BASE_MAINNET_RPC: 'https://base.example',
      POLYGON_MAINNET_RPC: 'https://polygon.example',
    });
    expect(listChains().map((c) => c.id)).toEqual(expect.arrayContaining([1, 8453, 137]));
    expect(getChain(137).testnet).toBe(false);
  });
});

describe('tokens', () => {
  it('returns the supported assets for each pilot chain', () => {
    for (const id of [31337, 11155111, 84532, 80002]) {
      const symbols = getTokens(id).map((t) => t.symbol);
      expect(symbols).toContain('USDC');
      expect(symbols).toContain(id === 80002 ? 'POL' : 'ETH');
    }
  });

  it('registers verified mainnet USDC and USDT assets', () => {
    loadEnv({});
    expect(getToken(1, 'USDC')?.decimals).toBe(6);
    expect(getToken(1, 'USDT')?.decimals).toBe(6);
    expect(getToken(8453, 'USDC')?.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(getToken(137, 'USDC')?.address).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    expect(getToken(137, 'USDT')?.address).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
  });

  it('exposes a default slippage tolerance', () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBeGreaterThan(0);
  });
});
