/**
 * Server-resolution tests.
 *
 * Guards the static-host case: on GitHub Pages there is no WebSocket server,
 * and a page served over HTTPS cannot open a ws:// socket anyway. Getting this
 * wrong shows four menu options where three of them silently time out.
 */
import { describe, expect, test } from 'bun:test';
import { resolveServer } from '../src/game/serverUrl.js';

describe('resolveServer', () => {
  test('local dev falls back to port 4040 on the same host', () => {
    const r = resolveServer({ configured: undefined, protocol: 'http:', hostname: 'localhost' });
    expect(r.url).toBe('ws://localhost:4040');
    expect(r.multiplayer).toBe(true);
  });

  test('LAN play over http keeps multiplayer available', () => {
    const r = resolveServer({ configured: undefined, protocol: 'http:', hostname: '192.168.1.11' });
    expect(r.url).toBe('ws://192.168.1.11:4040');
    expect(r.multiplayer).toBe(true);
  });

  test('HTTPS with no configured server disables multiplayer', () => {
    // This is GitHub Pages. Offering online modes here would be a lie.
    const r = resolveServer({ configured: undefined, protocol: 'https:', hostname: 'x.github.io' });
    expect(r.multiplayer).toBe(false);
  });

  test('HTTPS with an insecure ws:// server disables multiplayer', () => {
    // The browser blocks this as mixed content, so it can never work.
    const r = resolveServer({
      configured: 'ws://example.com:4040',
      protocol: 'https:',
      hostname: 'x.github.io',
    });
    expect(r.multiplayer).toBe(false);
  });

  test('HTTPS with a wss:// server enables multiplayer', () => {
    const r = resolveServer({
      configured: 'wss://uno.example.com',
      protocol: 'https:',
      hostname: 'x.github.io',
    });
    expect(r.url).toBe('wss://uno.example.com');
    expect(r.multiplayer).toBe(true);
  });

  test('an empty configured value is treated as absent', () => {
    // CI passes an unset repository variable through as "".
    const r = resolveServer({ configured: '  ', protocol: 'https:', hostname: 'x.github.io' });
    expect(r.multiplayer).toBe(false);
    expect(r.url).toBe('ws://x.github.io:4040');
  });
});
