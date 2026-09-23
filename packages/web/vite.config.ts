import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  // Workspace packages are plain TypeScript source, so Vite must compile them
  // rather than treat them as pre-built dependencies.
  optimizeDeps: { exclude: ['@uno/engine', '@uno/bots', '@uno/protocol'] },
  build: { target: 'es2022', sourcemap: true },
});
