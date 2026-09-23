/**
 * Deciding where the game server is, and whether there is one at all.
 *
 * Pure so it can be tested: this is exactly the kind of logic that silently
 * breaks on a static host and shows the user four menu options, three of
 * which time out.
 *
 * Three deployment shapes have to work:
 *
 *   local / LAN    http page, server on :4040 alongside it
 *   one container  https page served BY the game server (Render, Fly, Docker)
 *   static host    https page, no server anywhere (GitHub Pages)
 *
 * The middle case cannot be guessed at runtime - an HTTPS page on Render and
 * an HTTPS page on GitHub Pages look identical to the browser - so the Docker
 * build sets VITE_UNO_SAME_ORIGIN to declare it.
 */

export interface ServerConfig {
  url: string;
  /** False when no server could possibly be reached from this page. */
  multiplayer: boolean;
}

export function resolveServer(opts: {
  /** VITE_UNO_SERVER, baked in at build time. An explicit address. */
  configured: string | undefined;
  /** VITE_UNO_SAME_ORIGIN, set when the server also serves this page. */
  sameOrigin: string | undefined;
  /** location.protocol, e.g. "https:" */
  protocol: string;
  /** location.hostname */
  hostname: string;
  /** location.port, "" when the default port for the scheme is used. */
  port?: string;
}): ServerConfig {
  const configured = opts.configured?.trim();
  const secure = opts.protocol === 'https:';

  // An explicit address always wins.
  if (configured) {
    // The browser blocks ws:// from a secure page as mixed content, so an
    // insecure address on an HTTPS page can never connect.
    if (secure && !configured.startsWith('wss://')) {
      return { url: configured, multiplayer: false };
    }
    return { url: configured, multiplayer: true };
  }

  // Single-container deploy: the page came from the game server, so the
  // socket lives at the same origin, on whatever port the page used.
  if (opts.sameOrigin === '1' || opts.sameOrigin === 'true') {
    const scheme = secure ? 'wss' : 'ws';
    const port = opts.port ? `:${opts.port}` : '';
    return { url: `${scheme}://${opts.hostname}${port}`, multiplayer: true };
  }

  // Not HTTPS: local dev or LAN play. A server may well be running alongside
  // on the conventional port.
  if (!secure) {
    return { url: `ws://${opts.hostname || '127.0.0.1'}:4040`, multiplayer: true };
  }

  // HTTPS with nothing configured: a static host. There is no server.
  return { url: `wss://${opts.hostname}`, multiplayer: false };
}
