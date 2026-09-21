/**
 * Store tests. These write to a temp directory, never the real ~/.uno-no-mercy.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulateForTest } from './fixtures.js';
import { Store } from '../src/game/store.js';

const dirs: string[] = [];
function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'uno-test-'));
  dirs.push(dir);
  return new Store(dir);
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const match = (over: Partial<Parameters<Store['record']>[0]> = {}) => ({
  playedAt: 1_700_000_000_000,
  seed: 42,
  players: 4,
  bots: 3,
  difficulty: 'medium',
  won: true,
  place: 1,
  turns: 60,
  eliminations: 1,
  worstHit: 10,
  durationMs: 120_000,
  replayFile: null,
  ...over,
});

describe('store', () => {
  test('records a match and reads it back', () => {
    const s = tempStore();
    expect(s.disabled).toBeNull();
    const id = s.record(match());
    expect(id).toBeGreaterThan(0);

    const recent = s.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]!.won).toBe(true);
    expect(recent[0]!.difficulty).toBe('medium');
    s.close();
  });

  test('aggregates stats across matches', () => {
    const s = tempStore();
    s.record(match({ won: true, difficulty: 'hard', turns: 50 }));
    s.record(match({ won: false, difficulty: 'hard', turns: 70 }));
    s.record(match({ won: false, difficulty: 'easy', turns: 90 }));

    const stats = s.stats();
    expect(stats.games).toBe(3);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBeCloseTo(1 / 3);
    expect(stats.avgTurns).toBeCloseTo(70);
    expect(stats.byDifficulty.find((d) => d.difficulty === 'hard')!.games).toBe(2);
    s.close();
  });

  test('empty store reports zeroes rather than throwing', () => {
    const s = tempStore();
    expect(s.stats().games).toBe(0);
    expect(s.recent()).toEqual([]);
    expect(s.listReplays()).toEqual([]);
    s.close();
  });

  test('saves and reloads a replay that still reproduces the game', async () => {
    const s = tempStore();
    const { replay, finalStateJson } = simulateForTest(1234);
    const file = s.saveReplay(replay, 'game-0001');
    expect(file).toBe('game-0001.json');
    expect(s.listReplays()).toEqual(['game-0001.json']);

    const loaded = s.loadReplay('game-0001.json')!;
    const { finalState } = await import('@uno/engine');
    expect(JSON.stringify(finalState(loaded))).toBe(finalStateJson);
    s.close();
  });

  test('a bad replay filename returns null instead of throwing', () => {
    const s = tempStore();
    expect(s.loadReplay('nope.json')).toBeNull();
    s.close();
  });

  test('an unusable directory disables the store but does not throw', () => {
    // /dev/null is a file, so mkdir beneath it must fail.
    const s = new Store('/dev/null/definitely-not-a-dir');
    expect(s.disabled).not.toBeNull();
    expect(s.stats().games).toBe(0);
    expect(s.record(match())).toBeNull();
    s.close();
  });
});
