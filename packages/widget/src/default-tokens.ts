/** Default mainnet source assets exposed by the reusable deposit widget. */
export const DEFAULT_SOURCE_TOKEN_BY_CHAIN: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  143: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
};

export const DEFAULT_SUPPORTED_TOKENS_BY_CHAIN: Record<number, Array<{ symbol: string; address: string; decimals: number }>> = {
  1: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[1]!, decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  ],
  8453: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[8453]!, decimals: 6 },
    { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
  ],
  137: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[137]!, decimals: 6 },
    // Legacy bridged USDC still held by many Polygon wallets.
    { symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  ],
  43114: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[43114]!, decimals: 6 },
    { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBC13d4dF4A8c7', decimals: 6 },
  ],
  42161: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[42161]!, decimals: 6 },
    { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
  ],
  10: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[10]!, decimals: 6 },
    { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499Ad98a8ce58e58', decimals: 6 },
  ],
  59144: [
    { symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[59144]!, decimals: 6 },
    { symbol: 'USDT', address: '0xa219439258ca9da29e9cc4ce5596924745e12b93', decimals: 6 },
  ],
  143: [{ symbol: 'USDC', address: DEFAULT_SOURCE_TOKEN_BY_CHAIN[143]!, decimals: 6 }],
};
