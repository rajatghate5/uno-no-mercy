/**
 * House-rule tests.
 *
 * A settings panel that renders but does not change the game is worse than no
 * panel, so these assert the rules reach the dealt game and that hostile
 * values are clamped rather than trusted.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DEFAULT_HOUSE_RULES, PROTOCOL_VERSION, cleanHouseRules, type ServerMessage } from '@mercy/protocol';
import { createServer } from '../src/server.js';

let handle: ReturnType<typeof createServer>;
let url: string;

beforeAll(() => {
  handle = createServer({ port: 0, hostname: '127.0.0.1', botDelayMs: 0 });
  url = `ws://127.0.0.1:${handle.server.port}`;
});
afterAll(() => handle.stop());

function connect(): Promise<{
  send: (m: unknown) => void;
  wait: <T extends ServerMessage['t']>(t: T) => Promise<Extract<ServerMessage, { t: T }>>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const seen: ServerMessage[] = [];
    const waiters: { t: string; ok: (m: ServerMessage) => void }[] = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMessage;
      seen.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.t === m.t) {
          waiters[i]!.ok(m);
          waiters.splice(i, 1);
        }
      }
    };
    ws.onerror = () => reject(new Error('ws failed'));
    ws.onopen = () =>
      resolve({
        send: (m) => ws.send(JSON.stringify(m)),
        wait: (t) => {
          const hit = seen.find((m) => m.t === t);
          if (hit) return Promise.resolve(hit as never);
          return new Promise((ok, no) => {
            const timer = setTimeout(() => no(new Error(`timeout waiting for ${t}`)), 4000);
            waiters.push({
              t,
              ok: (m) => {
                clearTimeout(timer);
                ok(m as never);
              },
            });
          });
        },
        close: () => ws.close(),
      });
  });
}

describe('cleanHouseRules', () => {
  test('defaults anything missing', () => {
    expect(cleanHouseRules({})).toEqual(DEFAULT_HOUSE_RULES);
    expect(cleanHouseRules(undefined)).toEqual(DEFAULT_HOUSE_RULES);
  });

  test('clamps values into a playable range', () => {
    const r = cleanHouseRules({ startingHand: 999, handLimit: -5 });
    expect(r.startingHand).toBeLessThanOrEqual(12);
    expect(r.handLimit).toBeGreaterThanOrEqual(10);
  });

  test('never lets the Mercy limit sit at or below the deal', () => {
    // Otherwise every player is eliminated the moment cards are dealt.
    const r = cleanHouseRules({ startingHand: 12, handLimit: 10 });
    expect(r.handLimit).toBeGreaterThan(r.startingHand);
  });

  test('rejects non-numeric and non-boolean junk', () => {
    const r = cleanHouseRules({ startingHand: 'lots', stacking: 'yes', handLimit: NaN });
    expect(r.startingHand).toBe(DEFAULT_HOUSE_RULES.startingHand);
    expect(r.stacking).toBe(DEFAULT_HOUSE_RULES.stacking);
    expect(r.handLimit).toBe(DEFAULT_HOUSE_RULES.handLimit);
  });
});

describe('turn timer', () => {
  test('auto-plays for a human who runs out of time', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'afk',
      version: PROTOCOL_VERSION,
      // 15s is the shortest the UI offers; the server clamps to that set.
      settings: { botCount: 1, difficulty: 'easy', maxPlayers: 4, turnSeconds: 15 },
    });
    const welcome = await c.wait('welcome');
    const lobby = await c.wait('lobby');
    expect(lobby.settings.turnSeconds).toBe(15);
    c.send({ t: 'start' });
    const first = await c.wait('state');
    // The host is seated first, so the timer is running against us.
    expect(first.state.players[first.state.turn]!.id).toBe(welcome.you);
    c.close();
  });

  test('an unknown timer value falls back to no limit', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'host',
      version: PROTOCOL_VERSION,
      settings: { botCount: 1, difficulty: 'easy', maxPlayers: 4, turnSeconds: 7 },
    });
    await c.wait('welcome');
    const lobby = await c.wait('lobby');
    expect(lobby.settings.turnSeconds).toBe(0);
    c.close();
  });
});

describe('force play', () => {
  test('reaches the dealt game', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'host',
      version: PROTOCOL_VERSION,
      settings: {
        botCount: 1,
        difficulty: 'easy',
        maxPlayers: 4,
        rules: { ...DEFAULT_HOUSE_RULES, forcePlay: true, drawUntilPlayable: true },
      },
    });
    await c.wait('welcome');
    c.send({ t: 'start' });
    const state = await c.wait('state');
    expect(state.state.rules.forcePlay).toBe(true);
    expect(state.state.rules.drawUntilPlayable).toBe(true);
    c.close();
  });
});

describe('house rules reach the game', () => {
  test('a custom starting hand changes what is dealt', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'host',
      version: PROTOCOL_VERSION,
      settings: {
        botCount: 2,
        difficulty: 'easy',
        maxPlayers: 4,
        rules: { ...DEFAULT_HOUSE_RULES, startingHand: 5 },
      },
    });
    await c.wait('welcome');
    c.send({ t: 'start' });
    const state = await c.wait('state');
    const me = state.state.players.find((p) => p.id === state.state.viewer)!;
    expect(me.hand).toHaveLength(5);
    expect(state.state.players.every((p) => p.handCount === 5)).toBe(true);
    c.close();
  });

  test('a custom Mercy limit reaches the clients', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'host',
      version: PROTOCOL_VERSION,
      settings: {
        botCount: 1,
        difficulty: 'easy',
        maxPlayers: 4,
        rules: { ...DEFAULT_HOUSE_RULES, handLimit: 15 },
      },
    });
    await c.wait('welcome');
    c.send({ t: 'start' });
    const state = await c.wait('state');
    expect(state.state.rules.handLimit).toBe(15);
    c.close();
  });

  test('turning stacking off is honoured by the engine', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'host',
      version: PROTOCOL_VERSION,
      settings: {
        botCount: 1,
        difficulty: 'easy',
        maxPlayers: 4,
        rules: { ...DEFAULT_HOUSE_RULES, stacking: false },
      },
    });
    await c.wait('welcome');
    c.send({ t: 'start' });
    const state = await c.wait('state');
    expect(state.state.rules.stackingEnabled).toBe(false);
    c.close();
  });

  test('a hostile client cannot deal itself an unplayable table', async () => {
    const c = await connect();
    c.send({
      t: 'create',
      name: 'cheat',
      version: PROTOCOL_VERSION,
      settings: {
        botCount: 1,
        difficulty: 'easy',
        maxPlayers: 4,
        rules: { startingHand: 9999, handLimit: 1 },
      },
    });
    await c.wait('welcome');
    const lobby = await c.wait('lobby');
    expect(lobby.settings.rules.startingHand).toBeLessThanOrEqual(12);
    expect(lobby.settings.rules.handLimit).toBeGreaterThan(lobby.settings.rules.startingHand);
    c.close();
  });
});
