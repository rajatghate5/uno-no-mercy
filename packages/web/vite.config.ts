import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so assets need that
  // prefix. Defaults to "/" for local dev and any root-hosted deployment.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, host: true },
  // Workspace packages are plain TypeScript source, so Vite must compile them
  // rather than treat them as pre-built dependencies.
  optimizeDeps: { exclude: ['@mercy/engine', '@mercy/bots', '@mercy/protocol'] },
  build: { target: 'es2022', sourcemap: true },
});
