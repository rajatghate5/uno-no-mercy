/**
 * Move legality — the single source of truth.
 *
 * The TUI uses this to dim unplayable cards, the bots use it to choose, and
 * the server uses it to validate incoming intents. Because all three call the
 * same function, they cannot disagree about what is legal.
 */

import {
  drawValue,
  isDrawCard,
  isWild,
  type Card,
  type Color,
  type GameState,
  type Phase,
  type PlayerId,
} from './types.js';

/**
 * The minimum a caller must know to judge playability.
 *
 * Both full GameState and RedactedState can produce one of these, which is
 * what lets bots reason from redacted state using the SAME legality code the
 * server validates with. No second implementation to drift.
 */
export interface PlayView {
  readonly phase: Phase;
  readonly pendingDraw: number;
  readonly stackValue: number;
  readonly activeColor: Color | null;
  readonly stackingEnabled: boolean;
  readonly discardTop: Card | undefined;
}

export function viewOf(state: GameState): PlayView {
  return {
    phase: state.phase,
    pendingDraw: state.pendingDraw,
    stackValue: state.stackValue,
    activeColor: state.activeColor,
    stackingEnabled: state.rules.stackingEnabled,
    discardTop: state.discardPile[state.discardPile.length - 1],
  };
}

export type Action =
  | { type: 'play'; player: PlayerId; cardId: string }
  | { type: 'draw'; player: PlayerId }
  /** Take the accumulated stack penalty instead of continuing it. */
  | { type: 'takeStack'; player: PlayerId }
  | { type: 'chooseColor'; player: PlayerId; color: Color }
  | { type: 'chooseSwapTarget'; player: PlayerId; target: PlayerId }
  | { type: 'chooseRouletteColor'; player: PlayerId; color: Color };

export function topCard(state: GameState): Card | undefined {
  return state.discardPile[state.discardPile.length - 1];
}

/**
 * Can `card` be played right now, ignoring whose turn it is?
 *
 * Two distinct regimes:
 *
 *  1. A draw stack is live (pendingDraw > 0). Only draw cards may be played,
 *     and only those with draw value >= the stack's current value. Colour is
 *     IRRELEVANT while stacking — that is a No Mercy rule, not standard UNO.
 *
 *  2. Normal play. Match the active colour, or the top card's kind/rank, or
 *     play any wild.
 */
export function canPlayView(view: PlayView, card: Card): boolean {
  if (view.phase.type !== 'play') return false;

  if (view.pendingDraw > 0) {
    if (!view.stackingEnabled) return false;
    // Color Roulette is not a fixed-value draw card and never joins a stack.
    if (card.kind === 'wildColorRoulette') return false;
    if (!isDrawCard(card.kind)) return false;
    return drawValue(card.kind) >= view.stackValue;
  }

  if (isWild(card.kind)) return true;

  const top = view.discardTop;
  if (!top) return true;

  if (card.color && card.color === view.activeColor) return true;

  // Match by kind; for number cards the rank must match too.
  if (card.kind === top.kind) {
    if (card.kind === 'number') return card.rank === top.rank;
    return true;
  }

  return false;
}

export function canPlay(state: GameState, card: Card): boolean {
  return canPlayView(viewOf(state), card);
}

/** Every card in this player's hand they could legally play right now. */
export function legalMoves(state: GameState, playerId: PlayerId): Card[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated || player.finished) return [];
  if (state.players[state.turn]?.id !== playerId) return [];
  return player.hand.filter((c) => canPlay(state, c));
}

/** Is this action well-formed and permitted in the current phase? */
export function isLegalAction(state: GameState, action: Action): boolean {
  const current = state.players[state.turn];
  if (!current) return false;

  switch (state.phase.type) {
    case 'gameOver':
      return false;

    case 'chooseColor':
      return action.type === 'chooseColor' && action.player === current.id;

    case 'chooseSwapTarget': {
      if (action.type !== 'chooseSwapTarget' || action.player !== current.id) return false;
      const target = state.players.find((p) => p.id === action.target);
      return !!target && !target.eliminated && !target.finished && target.id !== current.id;
    }

    case 'chooseRouletteColor':
      return action.type === 'chooseRouletteColor' && action.player === state.phase.victim;

    case 'play': {
      if (action.player !== current.id) return false;
      if (action.type === 'play') {
        const card = current.hand.find((c) => c.id === action.cardId);
        return !!card && canPlay(state, card);
      }
      // You may only "take the stack" when there is one.
      if (action.type === 'takeStack') return state.pendingDraw > 0;
      // You may only draw normally when there is no live stack.
      if (action.type === 'draw') return state.pendingDraw === 0;
      return false;
    }
  }
}
