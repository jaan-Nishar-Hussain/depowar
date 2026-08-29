import { defineConfig } from '@playwright/test';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from './wallet-setup/basic.setup';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    ...metaMaskFixtures(basicSetup),
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});