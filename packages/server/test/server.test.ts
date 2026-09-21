/**
 * Server integration tests: real websockets, real rooms, real games.
 *
 * These run against an actual Bun.serve instance on an ephemeral port, so they
 * exercise the wire format and the authority boundary rather than mocks.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION, type ServerMessage } from '@uno/protocol';
import { createServer } from '../src/server.js';

let handle: ReturnType<typeof createServer>;
let url: string;

/** Built at runtime so this source file contains no literal control bytes. */
const ESC = String.fromCharCode(27);

beforeAll(() => {
  handle = createServer({ port: 0, hostname: '127.0.0.1' });
  url = `ws://127.0.0.1:${handle.server.port}`;
});

afterAll(() => handle.stop());

/** A tiny test client that queues messages so tests can await specific ones. */
class Client {
  private ws: WebSocket;
  readonly received: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      this.received.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.match(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    };
  }

  static async connect(): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('ws failed to open'));
    });
    return new Client(ws);
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait for the next message of a type (or one already queued). */
  wait<T extends ServerMessage['t']>(t: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { t: T }>> {
    const existing = this.received.find((m) => m.t === t);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), timeoutMs);
      this.waiters.push({
        match: (m) => m.t === t,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  waitFor(match: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const existing = this.received.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  clear() {
    this.received.length = 0;
  }

  close() {
    this.ws.close();
  }
}

const V = PROTOCOL_VERSION;

describe('lobby', () => {
  test('creating a room returns a code and seats the host', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'rajat', settings: { botCount: 1 }, version: V });
    const welcome = await host.wait('welcome');
    expect(welcome.code).toHaveLength(4);
    expect(welcome.isHost).toBe(true);
    expect(welcome.token).toBeTruthy();

    const lobby = await host.wait('lobby');
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]!.name).toBe('rajat');
    host.close();
  });

  test('a second player can join by code and both see the lobby', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 0 }, version: V });
    const { code } = await host.wait('welcome');

    host.clear();
    const guest = await Client.connect();
    guest.send({ t: 'join', code, name: 'guest', version: V });
    await guest.wait('welcome');

    const lobby = await host.waitFor((m) => m.t === 'lobby' && m.players.length === 2);
    expect(lobby.t).toBe('lobby');
    host.close();
    guest.close();
  });

  test('joining a nonexistent room fails cleanly', async () => {
    const c = await Client.connect();
    c.send({ t: 'join', code: 'ZZZZ', name: 'nobody', version: V });
    const err = await c.wait('error');
    expect(err.code).toBe('no_such_room');
    c.close();
  });

  test('a duplicate name is rejected', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'same', settings: {}, version: V });
    const { code } = await host.wait('welcome');

    const guest = await Client.connect();
    guest.send({ t: 'join', code, name: 'same', version: V });
    const err = await guest.wait('error');
    expect(err.code).toBe('name_taken');
    host.close();
    guest.close();
  });

  test('a protocol mismatch is reported rather than silently misbehaving', async () => {
    const c = await Client.connect();
    c.send({ t: 'create', name: 'old', settings: {}, version: 999 });
    const err = await c.wait('error');
    expect(err.code).toBe('bad_version');
    c.close();
  });

  test('only the host can start', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 1 }, version: V });
    const { code } = await host.wait('welcome');
    const guest = await Client.connect();
    guest.send({ t: 'join', code, name: 'guest', version: V });
    await guest.wait('welcome');

    guest.send({ t: 'start' });
    const err = await guest.wait('error');
    expect(err.code).toBe('not_host');
    host.close();
    guest.close();
  });

  test('names are stripped of control characters', async () => {
    const host = await Client.connect();
    // An ESC sequence in a name would otherwise be printed raw into terminals.
    host.send({ t: 'create', name: ESC + '[31mevil', settings: {}, version: V });
    await host.wait('welcome');
    const lobby = await host.wait('lobby');
    expect(lobby.players[0]!.name).toBe('[31mevil');
    expect(lobby.players[0]!.name).not.toContain(ESC);
    host.close();
  });
});

describe('gameplay', () => {
  test('starting deals a redacted state to each player', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 2 }, version: V });
    await host.wait('welcome');
    host.clear();
    host.send({ t: 'start' });

    const state = await host.wait('state');
    expect(state.state.players).toHaveLength(3);
    const me = state.state.players.find((p) => p.id === state.state.viewer)!;
    expect(me.hand).toHaveLength(7);
    const others = state.state.players.filter((p) => p.id !== state.state.viewer);
    expect(others.every((p) => p.hand === undefined)).toBe(true);
    expect(others.every((p) => p.handCount === 7)).toBe(true);
    host.close();
  });

  test('the wire payload never contains another hand or the draw pile', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 2 }, version: V });
    await host.wait('welcome');
    host.clear();
    host.send({ t: 'start' });
    await host.wait('state');

    const wire = JSON.stringify(host.received);
    expect(wire).not.toContain('"drawPile"');
    expect(wire).not.toContain('"rng"');
    host.close();
  });

  test('an illegal action is rejected without changing the game', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 2 }, version: V });
    const welcome = await host.wait('welcome');
    host.send({ t: 'start' });
    await host.wait('state');
    host.clear();

    host.send({ t: 'action', action: { type: 'play', player: welcome.you, cardId: 'not-a-card' } });
    const err = await host.wait('error');
    expect(err.code).toBe('illegal_action');
    host.close();
  });

  test('a player cannot act on somebody else behalf', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 2 }, version: V });
    await host.wait('welcome');
    host.send({ t: 'start' });
    await host.wait('state');
    host.clear();

    // Forge an action attributed to a bot.
    host.send({ t: 'action', action: { type: 'draw', player: 'bot0' } });
    const err = await host.wait('error');
    expect(err.code).toBe('illegal_action');
    host.close();
  });

  test('a legal move advances the game', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 2 }, version: V });
    const welcome = await host.wait('welcome');
    host.send({ t: 'start' });
    const first = await host.wait('state');
    host.clear();

    // The host is seated first, so it is our turn.
    expect(first.state.players[first.state.turn]!.id).toBe(welcome.you);
    host.send({ t: 'action', action: { type: 'draw', player: welcome.you } });

    const next = await host.wait('state');
    const me = next.state.players.find((p) => p.id === welcome.you)!;
    expect(me.handCount).toBe(8);
    host.close();
  });
});

describe('chat', () => {
  test('messages reach everyone in the room', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 0 }, version: V });
    const { code } = await host.wait('welcome');
    const guest = await Client.connect();
    guest.send({ t: 'join', code, name: 'guest', version: V });
    await guest.wait('welcome');
    guest.clear();

    host.send({ t: 'chat', text: 'no mercy' });
    const msg = await guest.wait('chat');
    expect(msg.message.text).toBe('no mercy');
    expect(msg.message.name).toBe('host');
    expect(msg.message.at).toBeGreaterThan(0);
    host.close();
    guest.close();
  });

  test('chat is stripped of control characters', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 0 }, version: V });
    await host.wait('welcome');
    host.send({ t: 'chat', text: 'hi' + ESC + '[2Jthere' });
    const msg = await host.wait('chat');
    expect(msg.message.text).not.toContain(ESC);
    expect(msg.message.text).toBe('hi[2Jthere');
    host.close();
  });
});

describe('spectators and reconnect', () => {
  test('a spectator sees the game but no hands', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 1 }, version: V });
    const { code } = await host.wait('welcome');
    host.send({ t: 'start' });
    await host.wait('state');

    const watcher = await Client.connect();
    watcher.send({ t: 'spectate', code, name: 'watcher', version: V });
    const w = await watcher.wait('welcome');
    expect(w.spectator).toBe(true);

    const state = await watcher.wait('state');
    expect(state.state.players.every((p) => p.hand === undefined)).toBe(true);
    host.close();
    watcher.close();
  });

  test('a spectator cannot play', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 1 }, version: V });
    const { code } = await host.wait('welcome');
    host.send({ t: 'start' });
    await host.wait('state');

    const watcher = await Client.connect();
    watcher.send({ t: 'spectate', code, name: 'watcher', version: V });
    const w = await watcher.wait('welcome');
    watcher.clear();
    watcher.send({ t: 'action', action: { type: 'draw', player: w.you } });
    const err = await watcher.wait('error');
    expect(err.code).toBe('illegal_action');
    host.close();
    watcher.close();
  });

  test('a dropped player can resume their seat with their token', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 1 }, version: V });
    const welcome = await host.wait('welcome');
    host.send({ t: 'start' });
    const before = await host.wait('state');
    const handBefore = before.state.players.find((p) => p.id === welcome.you)!.hand!.length;
    host.close();

    // Reconnect with the token from the original welcome.
    const again = await Client.connect();
    again.send({ t: 'resume', code: welcome.code, token: welcome.token, version: V });
    const resumed = await again.wait('welcome');
    expect(resumed.code).toBe(welcome.code);
    expect(resumed.isHost).toBe(true);

    const state = await again.wait('state');
    const me = state.state.players.find((p) => p.id === resumed.you)!;
    expect(me.hand).toHaveLength(handBefore);
    again.close();
  });

  test('resuming with a bogus token is refused', async () => {
    const host = await Client.connect();
    host.send({ t: 'create', name: 'host', settings: { botCount: 1 }, version: V });
    const welcome = await host.wait('welcome');

    const attacker = await Client.connect();
    attacker.send({ t: 'resume', code: welcome.code, token: 'guessed-token', version: V });
    const err = await attacker.wait('error');
    expect(err.code).toBe('no_such_room');
    host.close();
    attacker.close();
  });
});

describe('health', () => {
  test('exposes a plain HTTP health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
