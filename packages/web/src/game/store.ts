/**
 * Match history, in the browser.
 *
 * The terminal build used bun:sqlite; there is no SQLite here, and a match
 * record is a few hundred bytes, so localStorage is the right size of tool.
 * Every read is defensive: a user can clear storage, run in private mode, or
 * have a quota error mid-write, and none of that may stop them playing.
 */

import type { Replay } from '@mercy/engine';

const KEY = 'no-mercy:matches';
const REPLAY_KEY = 'no-mercy:replays';
const MAX_MATCHES = 200;
/** Replays are the big ones; keep only the most recent few. */
const MAX_REPLAYS = 10;

export interface MatchRecord {
  playedAt: number;
  seed: number;
  players: number;
  bots: number;
  difficulty: string;
  won: boolean;
  eliminated: boolean;
  turns: number;
  eliminations: number;
  worstHit: number;
  durationMs: number;
}

export interface Stats {
  games: number;
  wins: number;
  winRate: number;
  eliminated: number;
  avgTurns: number;
  worstHit: number;
  byDifficulty: { difficulty: string; games: number; wins: number }[];
}

const EMPTY: Stats = {
  games: 0,
  wins: 0,
  winRate: 0,
  eliminated: 0,
  avgTurns: 0,
  worstHit: 0,
  byDifficulty: [],
};

export class Store {
  /** Set when storage is unusable (private mode, quota, disabled cookies). */
  readonly disabled: string | null = null;

  constructor() {
    try {
      const probe = '__uno_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch (e) {
      this.disabled = String(e);
    }
  }

  private readAll(): MatchRecord[] {
    if (this.disabled) return [];
    try {
      const raw = localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as MatchRecord[]) : [];
    } catch {
      // Corrupt payload: treat as no history rather than crashing the menu.
      return [];
    }
  }

  record(match: MatchRecord): void {
    if (this.disabled) return;
    try {
      const all = this.readAll();
      all.unshift(match);
      localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX_MATCHES)));
    } catch {
      // Out of quota, most likely. Losing a stat line is not worth an error.
    }
  }

  recent(limit = 10): MatchRecord[] {
    return this.readAll().slice(0, limit);
  }

  stats(): Stats {
    const all = this.readAll();
    if (all.length === 0) return EMPTY;

    const wins = all.filter((m) => m.won).length;
    const byDiff = new Map<string, { games: number; wins: number }>();
    for (const m of all) {
      const e = byDiff.get(m.difficulty) ?? { games: 0, wins: 0 };
      e.games++;
      if (m.won) e.wins++;
      byDiff.set(m.difficulty, e);
    }

    return {
      games: all.length,
      wins,
      winRate: wins / all.length,
      eliminated: all.filter((m) => m.eliminated).length,
      avgTurns: all.reduce((n, m) => n + m.turns, 0) / all.length,
      worstHit: all.reduce((n, m) => Math.max(n, m.worstHit), 0),
      byDifficulty: [...byDiff.entries()]
        .map(([difficulty, v]) => ({ difficulty, ...v }))
        .sort((a, b) => b.games - a.games),
    };
  }

  saveReplay(replay: Replay, label: string): void {
    if (this.disabled) return;
    try {
      const raw = localStorage.getItem(REPLAY_KEY);
      const list: { label: string; replay: Replay }[] = raw ? JSON.parse(raw) : [];
      list.unshift({ label, replay });
      localStorage.setItem(REPLAY_KEY, JSON.stringify(list.slice(0, MAX_REPLAYS)));
    } catch {
      // Replays are the first thing to sacrifice when storage is tight.
    }
  }

  listReplays(): { label: string; replay: Replay }[] {
    if (this.disabled) return [];
    try {
      const raw = localStorage.getItem(REPLAY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(REPLAY_KEY);
    } catch {
      /* nothing to do */
    }
  }
}
