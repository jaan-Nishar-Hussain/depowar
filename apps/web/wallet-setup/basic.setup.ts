import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * Wallet setup: imports the deterministic Anvil account into MetaMask and
 * points it at the local chain so the E2E deposit signs against the deployed
 * mock contracts.
 */
const setup: ReturnType<typeof defineWalletSetup> = defineWalletSetup(
  process.env.WALLET_PASSWORD ?? 'Test1234!',
  async (context, walletPage) => {
    const metamask = new MetaMask(context, walletPage, process.env.WALLET_PASSWORD ?? 'Test1234!');
    await metamask.importWalletFromPrivateKey(process.env.WALLET_PRIVATE_KEY ?? DEFAULT_PRIVATE_KEY);
    await metamask.addNetwork({
      name: 'Anvil Local',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      symbol: 'ETH',
    });
    await metamask.switchNetwork('Anvil Local');
  },
);

export default setup;