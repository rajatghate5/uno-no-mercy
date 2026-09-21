/**
 * Game events.
 *
 * The event log IS the replay: state === events.reduce(apply, initial).
 * Spectator mode, replay playback and the TUI animation queue all consume
 * this same stream, so they cost almost nothing to build.
 */

import type { Card, Color, PlayerId } from './types.js';

export type GameEvent =
  | { type: 'gameStarted'; players: PlayerId[]; seed: number }
  | { type: 'dealt'; player: PlayerId; count: number }
  | { type: 'cardPlayed'; player: PlayerId; card: Card }
  | { type: 'colorChosen'; player: PlayerId; color: Color }
  | { type: 'drew'; player: PlayerId; count: number }
  | { type: 'stackTaken'; player: PlayerId; count: number }
  | { type: 'stackGrew'; player: PlayerId; total: number }
  | { type: 'skipped'; player: PlayerId }
  | { type: 'everyoneSkipped'; by: PlayerId }
  | { type: 'reversed'; direction: 1 | -1 }
  | { type: 'handsPassed'; direction: 1 | -1 }
  | { type: 'handsSwapped'; a: PlayerId; b: PlayerId }
  | { type: 'discardedAll'; player: PlayerId; color: Color; count: number }
  | { type: 'rouletteStarted'; victim: PlayerId; color: Color }
  | { type: 'reshuffled'; count: number }
  | { type: 'eliminated'; player: PlayerId; handSize: number }
  | { type: 'finished'; player: PlayerId }
  | { type: 'turnChanged'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | null };
