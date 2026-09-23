/**
 * Browser store tests.
 *
 * Bun's test runner has no DOM, so localStorage is stubbed here rather than
 * pulling in a full DOM implementation for what is a five-method key/value API.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const { Store } = await import('../src/game/store.js');

const match = (over: Record<string, unknown> = {}) => ({
  playedAt: 1_700_000_000_000,
  seed: 42,
  players: 4,
  bots: 3,
  difficulty: 'medium',
  won: true,
  eliminated: false,
  turns: 60,
  eliminations: 1,
  worstHit: 10,
  durationMs: 120_000,
  ...over,
});

describe('store', () => {
  test('records a match and reads it back', () => {
    const s = new Store();
    expect(s.disabled).toBeNull();
    s.record(match());
    const recent = s.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]!.won).toBe(true);
  });

  test('aggregates stats across matches', () => {
    const s = new Store();
    s.record(match({ won: true, difficulty: 'hard', turns: 50 }));
    s.record(match({ won: false, difficulty: 'hard', turns: 70 }));
    s.record(match({ won: false, difficulty: 'easy', turns: 90 }));

    const stats = s.stats();
    expect(stats.games).toBe(3);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBeCloseTo(1 / 3);
    expect(stats.avgTurns).toBeCloseTo(70);
    expect(stats.byDifficulty.find((d) => d.difficulty === 'hard')!.games).toBe(2);
  });

  test('an empty store reports zeroes rather than throwing', () => {
    const s = new Store();
    expect(s.stats().games).toBe(0);
    expect(s.recent()).toEqual([]);
  });

  test('corrupt stored data is treated as no history', () => {
    localStorage.setItem('uno-no-mercy:matches', 'not json at all');
    const s = new Store();
    expect(s.recent()).toEqual([]);
    expect(s.stats().games).toBe(0);
  });

  test('unusable storage disables the store instead of throwing', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const s = new Store();
    expect(s.disabled).not.toBeNull();
    // Still safe to call: a blocked store must never stop a game starting.
    expect(() => s.record(match())).not.toThrow();
    expect(s.stats().games).toBe(0);
  });

  test('history is capped so storage cannot grow without bound', () => {
    const s = new Store();
    for (let i = 0; i < 260; i++) s.record(match({ turns: i }));
    expect(s.recent(1000).length).toBeLessThanOrEqual(200);
  });
});
