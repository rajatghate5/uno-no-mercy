/**
 * End-to-end: the real NetworkGame client against the real server.
 *
 * This is the test that proves LAN play actually works - it exercises the
 * client, the wire format, the server authority and the engine together.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { decide, emptyMemory } from '@uno/bots';
import { createServer } from '../../server/src/server.js';
import { NetworkGame } from '../src/game/network.js';

let handle: ReturnType<typeof createServer>;
let url: string;

beforeAll(() => {
  // Zero bot delay: a full game then plays in milliseconds, not ~30 seconds.
  handle = createServer({ port: 0, hostname: '127.0.0.1', botDelayMs: 0 });
  url = `ws://127.0.0.1:${handle.server.port}`;
});
afterAll(() => handle.stop());

/** Poll until a predicate holds, so tests never depend on fixed sleeps. */
async function until(fn: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for condition');
}

describe('network client', () => {
  test('hosts a room, starts, and receives a redacted deal', async () => {
    const host = new NetworkGame({
      url,
      name: 'host',
      mode: { kind: 'create', settings: { botCount: 2, difficulty: 'medium', maxPlayers: 4 } },
    });

    await until(() => host.status === 'lobby' && host.code.length === 4);
    expect(host.isHost).toBe(true);

    host.start();
    await until(() => host.view() !== null);

    const view = host.view()!;
    expect(view.players).toHaveLength(3);
    const me = view.players.find((p) => p.id === host.youId)!;
    expect(me.hand).toHaveLength(7);
    expect(view.players.filter((p) => p.id !== host.youId).every((p) => p.hand === undefined)).toBe(true);
    host.leave();
  });

  test('two clients see each other and share chat', async () => {
    const host = new NetworkGame({
      url,
      name: 'alice',
      mode: { kind: 'create', settings: { botCount: 0, difficulty: 'easy', maxPlayers: 4 } },
    });
    await until(() => host.status === 'lobby' && !!host.code);

    const guest = new NetworkGame({ url, name: 'bob', mode: { kind: 'join', code: host.code } });
    await until(() => guest.status === 'lobby');
    await until(() => host.lobby.length === 2);

    expect(host.lobby.map((p) => p.name).sort()).toEqual(['alice', 'bob']);
    expect(guest.isHost).toBe(false);

    host.say('ready?');
    await until(() => guest.chat.some((c) => c.text === 'ready?'));
    expect(guest.chat.at(-1)!.name).toBe('alice');

    host.leave();
    guest.leave();
  });

  test('a full game plays to completion over the wire', async () => {
    const host = new NetworkGame({
      url,
      name: 'solo',
      mode: { kind: 'create', settings: { botCount: 3, difficulty: 'medium', maxPlayers: 4 } },
    });
    await until(() => host.status === 'lobby' && !!host.code);
    host.start();
    await until(() => host.view() !== null);

    // Drive our seat with the bot brain until somebody wins.
    let rng = 0x1234;
    let guard = 0;
    while (!host.isOver && guard++ < 20000) {
      if (host.waitingOnHuman()) {
        const d = decide('medium', host.view()!, rng, emptyMemory());
        rng = d.rng;
        host.apply(d.action);
      }
      await new Promise((r) => setTimeout(r, 1));
    }

    expect(host.isOver).toBe(true);
    expect(host.winner).not.toBeNull();
    // The log should record a real game, not an instant no-op.
    expect(host.log.length).toBeGreaterThan(5);
    host.leave();
  }, 30_000);

  test('a spectator follows the game but sees no hands', async () => {
    const host = new NetworkGame({
      url,
      name: 'player',
      mode: { kind: 'create', settings: { botCount: 1, difficulty: 'easy', maxPlayers: 4 } },
    });
    await until(() => host.status === 'lobby' && !!host.code);
    host.start();
    await until(() => host.view() !== null);

    const watcher = new NetworkGame({ url, name: 'watcher', mode: { kind: 'spectate', code: host.code } });
    await until(() => watcher.view() !== null);

    expect(watcher.spectator).toBe(true);
    expect(watcher.view()!.players.every((p) => p.hand === undefined)).toBe(true);
    // A spectator must never be prompted to act.
    expect(watcher.waitingOnHuman()).toBe(false);

    host.leave();
    watcher.leave();
  });

  test('joining a bad code surfaces an error instead of hanging', async () => {
    const client = new NetworkGame({ url, name: 'lost', mode: { kind: 'join', code: 'ZZZZ' } });
    await until(() => client.status === 'error');
    expect(client.error).toContain('No room');
    client.leave();
  });

  test('an unreachable server reports an error rather than hanging', async () => {
    // Port 1 is reserved and nothing listens there.
    const client = new NetworkGame({ url: 'ws://127.0.0.1:1', name: 'x', mode: { kind: 'join', code: 'ABCD' } });
    await until(() => client.status === 'error' || client.status === 'closed', 8000);
    expect(['error', 'closed']).toContain(client.status);
  }, 12_000);
});
