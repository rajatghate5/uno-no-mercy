/**
 * Server-resolution tests.
 *
 * Guards the static-host case: on GitHub Pages there is no WebSocket server,
 * and a page served over HTTPS cannot open a ws:// socket anyway. Getting this
 * wrong shows four menu options where three of them silently time out.
 */
import { describe, expect, test } from 'bun:test';
import { resolveServer } from '../src/game/serverUrl.js';

/** Defaults for the fields a given case does not care about. */
const base = { configured: undefined, sameOrigin: undefined, port: '' };

describe('resolveServer', () => {
  test('local dev falls back to port 4040 on the same host', () => {
    const r = resolveServer({ ...base, protocol: 'http:', hostname: 'localhost' });
    expect(r.url).toBe('ws://localhost:4040');
    expect(r.multiplayer).toBe(true);
  });

  test('LAN play over http keeps multiplayer available', () => {
    const r = resolveServer({ ...base, protocol: 'http:', hostname: '192.168.1.11' });
    expect(r.url).toBe('ws://192.168.1.11:4040');
    expect(r.multiplayer).toBe(true);
  });

  test('HTTPS with no configured server disables multiplayer', () => {
    // This is GitHub Pages. Offering online modes here would be a lie.
    const r = resolveServer({ ...base, protocol: 'https:', hostname: 'x.github.io' });
    expect(r.multiplayer).toBe(false);
  });

  test('HTTPS with an insecure ws:// server disables multiplayer', () => {
    // The browser blocks this as mixed content, so it can never work.
    const r = resolveServer({
      ...base,
      configured: 'ws://example.com:4040',
      protocol: 'https:',
      hostname: 'x.github.io',
    });
    expect(r.multiplayer).toBe(false);
  });

  test('HTTPS with a wss:// server enables multiplayer', () => {
    const r = resolveServer({
      ...base,
      configured: 'wss://uno.example.com',
      protocol: 'https:',
      hostname: 'x.github.io',
    });
    expect(r.url).toBe('wss://uno.example.com');
    expect(r.multiplayer).toBe(true);
  });

  test('a one-container deploy talks to its own origin over wss', () => {
    // Render, Fly, or the Docker image: the page came FROM the game server, so
    // the socket is the same origin. An HTTPS page here is indistinguishable
    // from GitHub Pages to the browser, which is why the build declares it.
    const r = resolveServer({
      ...base,
      sameOrigin: '1',
      protocol: 'https:',
      hostname: 'uno.onrender.com',
    });
    expect(r.url).toBe('wss://uno.onrender.com');
    expect(r.multiplayer).toBe(true);
  });

  test('a one-container deploy on a non-default port keeps the port', () => {
    const r = resolveServer({
      ...base,
      sameOrigin: '1',
      protocol: 'http:',
      hostname: 'localhost',
      port: '4040',
    });
    expect(r.url).toBe('ws://localhost:4040');
    expect(r.multiplayer).toBe(true);
  });

  test('an empty configured value is treated as absent', () => {
    // CI passes an unset repository variable through as "".
    const r = resolveServer({ ...base, configured: '  ', protocol: 'https:', hostname: 'x.github.io' });
    expect(r.multiplayer).toBe(false);
    // Still a wss:// URL even though it is unreachable: an HTTPS page should
    // never be handed a ws:// address, not even one it will not use.
    expect(r.url).toBe('wss://x.github.io');
  });
});
