/** Server entry point. */
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 4040);
const hostname = process.env.HOST ?? '0.0.0.0';

const { server } = createServer({ port, hostname });

console.log(`uno-no-mercy server listening on ws://${hostname}:${server.port}`);
console.log(`health: http://${hostname}:${server.port}/health`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} - shutting down`);
    process.exit(0);
  });
}
