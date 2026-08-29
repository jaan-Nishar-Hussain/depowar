// Funds one or more accounts on the local Anvil node so the widget demo works
// from any wallet: ETH for gas, MockWETH/MockUSDC balances, and the approvals
// the routes need.
//
// Usage:
//   node scripts/anvil-fund.mjs <address> [<address> ...]
//
// Reads PAYMESH_* / ANVIL_* from the repo-root .env (or env vars).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseEther,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const {
  ANVIL_RPC_URL = 'http://127.0.0.1:8545',
  ANVIL_CHAIN_ID = '31337',
  ANVIL_ACCOUNT_PRIVATE_KEY,
  PAYMESH_DEX_ADDRESS,
  PAYMESH_BRIDGE_ADDRESS,
  PAYMESH_WETH_ADDRESS,
  PAYMESH_USDC_ADDRESS,
} = process.env;

if (!PAYMESH_DEX_ADDRESS || !PAYMESH_WETH_ADDRESS || !PAYMESH_USDC_ADDRESS) {
  console.error('Missing PAYMESH_WETH_ADDRESS / PAYMESH_USDC_ADDRESS / PAYMESH_DEX_ADDRESS in .env');
  process.exit(1);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/anvil-fund.mjs <address> [<address> ...]');
  process.exit(1);
}

const chain = {
  id: Number(ANVIL_CHAIN_ID),
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
};

const publicClient = createPublicClient({ chain, transport: http(ANVIL_RPC_URL) });
const deployer = privateKeyToAccount(ANVIL_ACCOUNT_PRIVATE_KEY);
const deployerClient = createWalletClient({ chain, transport: http(ANVIL_RPC_URL), account: deployer });

const { readArtifact } = await import('../packages/contracts/dist/index.js');
const erc20Abi = readArtifact('MockERC20').abi;

async function impersonate(address) {
  await publicClient.request({ method: 'anvil_impersonateAccount', params: [address] });
  const client = createWalletClient({ chain, transport: http(ANVIL_RPC_URL), account: address });
  return client;
}

for (const raw of targets) {
  const address = raw.toLowerCase();
  console.log(`\nFunding ${address}`);

  // 1) ETH for gas
  const balance = parseEther('10');
  await publicClient.request({ method: 'anvil_setBalance', params: [address, toHex(balance)] });
  console.log('  ETH     10.0');

  // 2) Mint source + destination tokens (owner = deployer)
  for (const [symbol, tokenAddress, amount] of [
    ['WETH', PAYMESH_WETH_ADDRESS, parseEther('100')],
    ['USDC', PAYMESH_USDC_ADDRESS, parseEther('100000')],
  ]) {
    const hash = await deployerClient.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'mint',
      args: [address, amount],
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol}   minted`);
  }

  // 3) Approvals (impersonating the account)
  const targetClient = await impersonate(address);
  for (const [symbol, tokenAddress, spender] of [
    ['WETH', PAYMESH_WETH_ADDRESS, PAYMESH_DEX_ADDRESS],
    ['USDC', PAYMESH_USDC_ADDRESS, PAYMESH_BRIDGE_ADDRESS],
  ]) {
    const hash = await targetClient.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, maxUint256],
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol}   approved ${spender.slice(0, 10)}…`);
  }
  await publicClient.request({ method: 'anvil_stopImpersonatingAccount', params: [address] });

  console.log(`  done`);
}

console.log('\nFunded. Refresh the widget and Confirm again.');