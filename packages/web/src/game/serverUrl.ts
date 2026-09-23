/**
 * Deciding where the game server is, and whether there is one at all.
 *
 * Pure so it can be tested: this is exactly the kind of logic that silently
 * breaks on a static host and shows the user four menu options, three of
 * which time out.
 */

export interface ServerConfig {
  url: string;
  /** False when no server could possibly be reached from this page. */
  multiplayer: boolean;
}

export function resolveServer(opts: {
  /** VITE_UNO_SERVER, baked in at build time. */
  configured: string | undefined;
  /** location.protocol, e.g. "https:" */
  protocol: string;
  /** location.hostname */
  hostname: string;
}): ServerConfig {
  const configured = opts.configured?.trim();
  const url =
    configured && configured.length > 0
      ? configured
      : `ws://${opts.hostname || '127.0.0.1'}:4040`;

  // Not HTTPS: local dev, LAN play, or the single-process Docker image. A
  // server may well be running alongside, so offer the online modes.
  if (opts.protocol !== 'https:') return { url, multiplayer: true };

  // HTTPS page. The browser blocks ws:// from a secure page as mixed content,
  // so only an explicitly configured wss:// server is reachable. On GitHub
  // Pages with nothing configured that means no multiplayer - say so up front
  // rather than letting every join attempt hang.
  const secure = !!configured && configured.startsWith('wss://');
  return { url, multiplayer: secure };
}
