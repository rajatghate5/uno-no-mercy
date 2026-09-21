# Game server image. The TUI client is NOT in here - players run the client
# locally (bun run play, or a downloaded binary) and connect to this over
# websocket. This image only needs the engine, bots, protocol and server.

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

# --- deps -------------------------------------------------------------------
# Copied separately so a source-only change does not re-resolve dependencies.
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/engine/package.json   packages/engine/
COPY packages/bots/package.json     packages/bots/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json   packages/server/
COPY packages/tui/package.json      packages/tui/
RUN bun install --frozen-lockfile

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY config ./config
COPY packages/engine   ./packages/engine
COPY packages/bots     ./packages/bots
COPY packages/protocol ./packages/protocol
COPY packages/server   ./packages/server

# Bun runs TypeScript directly, so there is no build step to go stale.
# Render (and most platforms) inject PORT; default to 4040 for local runs.
ENV PORT=4040
EXPOSE 4040

# Run as the unprivileged user the base image already provides.
USER bun

# The server has no disk state - rooms live in memory and die with the process.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4040)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "packages/server/src/main.ts"]
