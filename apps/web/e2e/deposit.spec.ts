import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

/**
 * Full wallet-driven deposit flow (PRD §16). Requires a running stack:
 *   anvil (:8545) + api (:4000) + worker + web (:5173), with the API key and
 *   recipient configured via env. Gated behind `pnpm test:wallet`.
 */
test('user completes a deposit through the widget', async ({ page, metamask }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await metamask.connectToDapp();
  await page.getByLabel('Amount').fill('0.01');
  await page.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await metamask.confirmTransaction();
  await expect(page.getByText('Deposit Completed')).toBeVisible({ timeout: 60_000 });
});