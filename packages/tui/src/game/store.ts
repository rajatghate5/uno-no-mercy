/**
 * Match history and replay storage.
 *
 * Uses bun:sqlite and node:fs, both built in, so this adds no dependency and
 * nothing to keep upgraded. The database is a single file you can delete at
 * any time; the game treats a missing or unreadable store as "no history"
 * rather than failing to start.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Replay } from '@uno/engine';

export interface MatchRecord {
  id?: number;
  playedAt: number;
  seed: number;
  players: number;
  bots: number;
  difficulty: string;
  won: boolean;
  /** Where the human placed: 1 = went out first. */
  place: number;
  turns: number;
  eliminations: number;
  /** Largest draw stack the human was hit with, for the "most brutal" stat. */
  worstHit: number;
  durationMs: number;
  replayFile: string | null;
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

function defaultDir(): string {
  // Respect XDG when set, fall back to ~/.uno-no-mercy.
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? join(xdg, 'uno-no-mercy') : join(homedir(), '.uno-no-mercy');
}

export class Store {
  private db: Database | null = null;
  readonly dir: string;
  readonly replayDir: string;
  /** Set when the store could not be opened; the game carries on without it. */
  readonly disabled: string | null = null;

  constructor(dir = defaultDir()) {
    this.dir = dir;
    this.replayDir = join(dir, 'replays');
    try {
      mkdirSync(this.replayDir, { recursive: true });
      this.db = new Database(join(dir, 'stats.db'));
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.migrate();
    } catch (e) {
      // A read-only home directory or a corrupt db must not stop you playing.
      this.disabled = String(e);
      this.db = null;
    }
  }

  private migrate() {
    this.db?.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        playedAt     INTEGER NOT NULL,
        seed         INTEGER NOT NULL,
        players      INTEGER NOT NULL,
        bots         INTEGER NOT NULL,
        difficulty   TEXT    NOT NULL,
        won          INTEGER NOT NULL,
        place        INTEGER NOT NULL,
        turns        INTEGER NOT NULL,
        eliminations INTEGER NOT NULL,
        worstHit     INTEGER NOT NULL DEFAULT 0,
        durationMs   INTEGER NOT NULL DEFAULT 0,
        replayFile   TEXT
      );
      CREATE INDEX IF NOT EXISTS matches_playedAt ON matches(playedAt DESC);
    `);
  }

  record(match: MatchRecord): number | null {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO matches
          (playedAt, seed, players, bots, difficulty, won, place, turns, eliminations, worstHit, durationMs, replayFile)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        match.playedAt,
        match.seed,
        match.players,
        match.bots,
        match.difficulty,
        match.won ? 1 : 0,
        match.place,
        match.turns,
        match.eliminations,
        match.worstHit,
        match.durationMs,
        match.replayFile,
      );
      return Number(info.lastInsertRowid);
    } catch {
      return null;
    }
  }

  stats(): Stats {
    const empty: Stats = {
      games: 0,
      wins: 0,
      winRate: 0,
      eliminated: 0,
      avgTurns: 0,
      worstHit: 0,
      byDifficulty: [],
    };
    if (!this.db) return empty;
    try {
      const row = this.db
        .query(
          `SELECT COUNT(*) AS games,
                  COALESCE(SUM(won), 0) AS wins,
                  COALESCE(AVG(turns), 0) AS avgTurns,
                  COALESCE(MAX(worstHit), 0) AS worstHit,
                  COALESCE(SUM(CASE WHEN place < 0 THEN 1 ELSE 0 END), 0) AS eliminated
           FROM matches`,
        )
        .get() as { games: number; wins: number; avgTurns: number; worstHit: number; eliminated: number } | null;
      if (!row || row.games === 0) return empty;

      const byDifficulty = this.db
        .query(
          `SELECT difficulty, COUNT(*) AS games, COALESCE(SUM(won),0) AS wins
           FROM matches GROUP BY difficulty ORDER BY games DESC`,
        )
        .all() as { difficulty: string; games: number; wins: number }[];

      return {
        games: row.games,
        wins: row.wins,
        winRate: row.games ? row.wins / row.games : 0,
        eliminated: row.eliminated,
        avgTurns: row.avgTurns,
        worstHit: row.worstHit,
        byDifficulty,
      };
    } catch {
      return empty;
    }
  }

  recent(limit = 10): MatchRecord[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .query(`SELECT * FROM matches ORDER BY playedAt DESC LIMIT ?`)
        .all(limit) as (Omit<MatchRecord, 'won'> & { won: number })[];
      return rows.map((r) => ({ ...r, won: r.won === 1 }));
    } catch {
      return [];
    }
  }

  /** Persist a replay next to the stats db. Returns the filename, or null. */
  saveReplay(replay: Replay, label: string): string | null {
    try {
      // Caller supplies the timestamp portion; the engine has no clock.
      const file = `${label}.json`;
      writeFileSync(join(this.replayDir, file), JSON.stringify(replay), 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  loadReplay(file: string): Replay | null {
    try {
      return JSON.parse(readFileSync(join(this.replayDir, file), 'utf8')) as Replay;
    } catch {
      return null;
    }
  }

  listReplays(): string[] {
    try {
      return readdirSync(this.replayDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  close() {
    this.db?.close();
  }
}
