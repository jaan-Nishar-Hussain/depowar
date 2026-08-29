import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Force a single React/wagmi/viem instance so the workspace widget package
// (which installs its own copies) shares the host's providers.
const sharedDeps = ['react', 'react-dom', 'wagmi', '@tanstack/react-query', 'viem'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: sharedDeps },
  server: { port: 5173 },
  preview: { port: 4173 },
});