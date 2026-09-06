import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const sharedDeps = ['react', 'react-dom', 'wagmi', '@tanstack/react-query', 'viem'];

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: sharedDeps },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: ['@ant-design/web3-icons', ...sharedDeps] } },
  },
});
