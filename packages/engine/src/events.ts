/**
 * Game events.
 *
 * The event log IS the replay: state === events.reduce(apply, initial).
 * Spectator mode, replay playback and the TUI animation queue all consume
 * this same stream, so they cost almost nothing to build.
 */

import type { Card, Color, PlayerId } from './types.js';

/**
 * Why a game ended.
 *
 * `wentOut`     someone played their last card.
 * `lastStanding` everyone else hit the hand limit and was eliminated.
 * `fewestCards` the cards ran out with nobody able to move, so the smallest
 *               hand takes it.
 */
export type GameOverReason = 'wentOut' | 'lastStanding' | 'fewestCards';

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
  /** Played a 7 and kept their hand. Only possible under the house rule. */
  | { type: 'swapDeclined'; player: PlayerId }
  | { type: 'discardedAll'; player: PlayerId; color: Color; count: number }
  | { type: 'rouletteStarted'; victim: PlayerId; color: Color }
  | { type: 'reshuffled'; count: number }
  /** Draw pile empty and nothing left in the discard to recycle. */
  | { type: 'deckExhausted' }
  | { type: 'eliminated'; player: PlayerId; handSize: number }
  | { type: 'finished'; player: PlayerId }
  | { type: 'unoRisked'; player: PlayerId }
  | { type: 'unoCalled'; player: PlayerId }
  | { type: 'unoCaught'; player: PlayerId; by: PlayerId }
  | { type: 'turnChanged'; player: PlayerId }
  | {
      type: 'gameOver';
      winner: PlayerId | null;
      /**
       * How it ended, so the game-over screen can say something truer than
       * "wins": emptied a hand, outlasted everyone, or held the smallest
       * hand when the cards ran out.
       */
      reason: GameOverReason;
    };
