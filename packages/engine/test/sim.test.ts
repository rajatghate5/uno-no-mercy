/**
 * Simulation tests — the ones that find bugs nobody thought to write a test for.
 */
import { describe, expect, test } from 'bun:test';
import { finalState, playback } from '@uno/engine';
import { simulate, totalCards } from './harness.js';
import type { Difficulty } from '@uno/bots';

describe('simulation', () => {
  test('500 four-player games all terminate with invariants intact', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = simulate({ seed });
      expect(r.finalState.phase.type).toBe('gameOver');
      expect(totalCards(r.finalState)).toBe(168);
    }
  });

  test.each([2, 3, 5, 8, 10])('games with %i players terminate', (playerCount) => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate({ seed, playerCount });
      expect(r.finalState.phase.type).toBe('gameOver');
      expect(totalCards(r.finalState)).toBe(168);
    }
  });

  test('mixed difficulties play together without error', () => {
    const difficulties: Difficulty[] = ['easy', 'medium', 'hard', 'medium'];
    for (let seed = 1; seed <= 200; seed++) {
      const r = simulate({ seed, playerCount: 4, difficulties });
      expect(r.finalState.phase.type).toBe('gameOver');
    }
  });

  test('every game produces exactly one winner or a sole survivor', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = simulate({ seed });
      const finished = r.finalState.players.filter((p) => p.finished);
      const active = r.finalState.players.filter((p) => !p.eliminated && !p.finished);
      expect(finished.length + active.length).toBeGreaterThanOrEqual(1);
      expect(r.winner).not.toBeUndefined();
    }
  });

  test('the mercy rule fires: some games end by elimination', () => {
    let withElims = 0;
    for (let seed = 1; seed <= 300; seed++) {
      if (simulate({ seed }).eliminations > 0) withElims++;
    }
    // If this is 0 the mercy rule silently stopped working.
    expect(withElims).toBeGreaterThan(0);
  });
});

describe('replay round-trip', () => {
  test('replaying a recorded game reproduces the exact final state', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = simulate({ seed });
      const replayed = finalState(r.replay);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(r.finalState));
    }
  });

  test('a replay survives JSON serialisation', () => {
    const r = simulate({ seed: 31337 });
    const roundTripped = JSON.parse(JSON.stringify(r.replay));
    expect(JSON.stringify(finalState(roundTripped))).toBe(JSON.stringify(r.finalState));
  });

  test('playback yields a frame per action plus the initial deal', () => {
    const r = simulate({ seed: 99 });
    const frames = playback(r.replay);
    expect(frames).toHaveLength(r.replay.actions.length + 1);
    expect(frames[0]!.actionIndex).toBe(-1);
    expect(frames.at(-1)!.state.phase.type).toBe('gameOver');
  });

  test('replays are compact', () => {
    const r = simulate({ seed: 5 });
    expect(JSON.stringify(r.replay).length).toBeLessThan(20_000);
  });
});
