/**
 * Hidden-information redaction.
 *
 * One function, three jobs:
 *   1. Anti-cheat  — the server only ever sends redacted state, so a modified
 *                    client physically cannot see another player's hand.
 *   2. Spectators  — spectators get the same treatment with no "own" hand.
 *   3. Bot fairness— bots are handed redacted state, so they cannot peek
 *                    either. A bot that cheats isn't a difficulty level.
 *
 * Because it is the only path state takes to a client, testing it once covers
 * every screen and every message type.
 */

import { canPlayView, type PlayView } from './legal.js';
import type { Card, GameState, PlayerId } from './types.js';

export const SPECTATOR = '__spectator__' as const;

/** A card whose identity is hidden — the viewer knows it exists, not what it is. */
export interface HiddenCard {
  readonly hidden: true;
}

export interface RedactedPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly eliminated: boolean;
  readonly finished: boolean;
  /** Present only for the viewer themselves. */
  readonly hand?: readonly Card[];
  readonly handCount: number;
}

export interface RedactedState {
  readonly players: readonly RedactedPlayer[];
  readonly turn: number;
  readonly direction: 1 | -1;
  readonly drawPileCount: number;
  readonly discardTop: Card | undefined;
  readonly discardCount: number;
  readonly activeColor: GameState['activeColor'];
  readonly pendingDraw: number;
  readonly stackValue: number;
  readonly phase: GameState['phase'];
  /** Who is one card away and has not called UNO. Public by design. */
  readonly unoRisk: PlayerId | null;
  readonly viewer: PlayerId;
  /** Public rules, so a client can reason about legality without the server. */
  readonly rules: GameState['rules'];
}

/**
 * Adapt redacted state to the shared legality view, so clients and bots use
 * the exact same canPlayView() the server validates with.
 */
export function viewOfRedacted(s: RedactedState): PlayView {
  return {
    phase: s.phase,
    pendingDraw: s.pendingDraw,
    stackValue: s.stackValue,
    activeColor: s.activeColor,
    stackingEnabled: s.rules.stackingEnabled,
    stackMode: s.rules.stackMode,
    discardTop: s.discardTop,
  };
}

/** The viewer's own hand, or [] if they are a spectator. */
export function ownHand(s: RedactedState): readonly Card[] {
  return s.players.find((p) => p.id === s.viewer)?.hand ?? [];
}

/** Cards the viewer could legally play right now. */
export function playableFor(s: RedactedState): Card[] {
  if (s.players[s.turn]?.id !== s.viewer) return [];
  const view = viewOfRedacted(s);
  return ownHand(s).filter((c) => canPlayView(view, c));
}

/**
 * Project state down to what `viewer` is allowed to know.
 *
 * Note what is deliberately absent: `rng` (knowing it predicts every future
 * draw), `drawPile` contents and order, and every other player's hand.
 */
export function redactFor(state: GameState, viewer: PlayerId): RedactedState {
  return {
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      eliminated: p.eliminated,
      finished: p.finished,
      ...(p.id === viewer ? { hand: [...p.hand] } : {}),
      handCount: p.hand.length,
    })),
    turn: state.turn,
    direction: state.direction,
    drawPileCount: state.drawPile.length,
    discardTop: state.discardPile[state.discardPile.length - 1],
    discardCount: state.discardPile.length,
    activeColor: state.activeColor,
    pendingDraw: state.pendingDraw,
    stackValue: state.stackValue,
    phase: state.phase,
    unoRisk: state.unoRisk,
    viewer,
    rules: state.rules,
  };
}
