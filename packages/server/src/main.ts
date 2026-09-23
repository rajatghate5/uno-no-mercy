/** Server entry point. */
import { existsSync } from 'node:fs';
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 4040);
const hostname = process.env.HOST ?? '0.0.0.0';

// Serve the built client when it exists, so production is a single process.
// In development, Vite serves the client and this stays undefined.
const candidate = process.env.UNO_STATIC ?? 'packages/web/dist';
const staticRoot = existsSync(candidate) ? candidate : undefined;

const { server } = createServer({ port, hostname, staticRoot });

console.log(`uno-no-mercy server listening on http://${hostname}:${server.port}`);
console.log(staticRoot ? `serving client from ${staticRoot}` : 'no built client - run "bun run build" or use "bun run dev"');
console.log(`health: http://${hostname}:${server.port}/health`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} - shutting down`);
    process.exit(0);
  });
}
