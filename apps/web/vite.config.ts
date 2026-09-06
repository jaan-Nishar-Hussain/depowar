import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Force a single React/wagmi/viem instance so the workspace widget package
// (which installs its own copies) shares the host's providers.
const sharedDeps = ['react', 'react-dom', 'wagmi', '@tanstack/react-query', 'viem'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: sharedDeps,
    alias: {
      // Point directly at the widget src so Vite HMR picks up changes
      // without needing a dist/ rebuild during development.
      '@paymesh/widget': path.resolve(__dirname, '../../packages/widget/src/index.ts'),
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});