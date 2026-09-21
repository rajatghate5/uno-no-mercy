/**
 * Core domain types for UNO Show 'Em No Mercy.
 *
 * This package is PURE: no I/O, no Math.random(), no Date.now(). Every source
 * of nondeterminism is threaded explicitly through GameState so that a game is
 * fully reproducible from its seed. That is what makes replays exact and
 * makes a failing simulation seed debuggable.
 */

export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = (typeof COLORS)[number];

/** Every card kind in the deck. */
export type CardKind =
  // coloured
  | 'number'
  | 'drawTwo'
  | 'skip'
  | 'reverse'
  | 'drawFour'            // the COLOURED +4
  | 'skipEveryone'
  | 'discardAll'
  // wild (colourless until played)
  | 'wild'
  | 'wildDrawFour'
  | 'wildDrawSix'
  | 'wildDrawTen'
  | 'wildReverseDrawFour'
  | 'wildColorRoulette';

export const WILD_KINDS = [
  'wild',
  'wildDrawFour',
  'wildDrawSix',
  'wildDrawTen',
  'wildReverseDrawFour',
  'wildColorRoulette',
] as const satisfies readonly CardKind[];

export type WildKind = (typeof WILD_KINDS)[number];

export function isWild(kind: CardKind): kind is WildKind {
  return (WILD_KINDS as readonly string[]).includes(kind);
}

/**
 * How many cards this kind forces the next player to draw.
 * 0 means it is not a draw card and cannot participate in a stack.
 *
 * Wild Color Roulette is deliberately 0: it does not add a fixed amount to a
 * stack, it makes the victim draw until they hit a colour. It is resolved
 * separately and is NOT stackable.
 */
export const DRAW_VALUE: Record<CardKind, number> = {
  number: 0,
  skip: 0,
  reverse: 0,
  skipEveryone: 0,
  discardAll: 0,
  wild: 0,
  wildColorRoulette: 0,

  drawTwo: 2,
  drawFour: 4,
  wildDrawFour: 4,
  wildReverseDrawFour: 4,
  wildDrawSix: 6,
  wildDrawTen: 10,
};

export function drawValue(kind: CardKind): number {
  return DRAW_VALUE[kind];
}

export function isDrawCard(kind: CardKind): boolean {
  return DRAW_VALUE[kind] > 0;
}

export interface Card {
  /** Stable unique id. Lets the UI track a specific physical card across moves. */
  readonly id: string;
  readonly kind: CardKind;
  /** undefined for wild cards (they have no colour until played). */
  readonly color?: Color;
  /** 0-9, only present when kind === 'number'. */
  readonly rank?: number;
}

export type PlayerId = string;

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly hand: readonly Card[];
  /** Eliminated by the Mercy Rule (hand reached the limit) or by leaving. */
  readonly eliminated: boolean;
  /** Finished by playing their last card. */
  readonly finished: boolean;
  readonly isBot: boolean;
}

export type Direction = 1 | -1;

/** What the engine is waiting for. Drives which actions are legal. */
export type Phase =
  /** Normal turn: current player plays or draws. */
  | { readonly type: 'play' }
  /** A wild was played; that player must name a colour. */
  | { readonly type: 'chooseColor'; readonly card: Card }
  /** A 7 was played; that player must pick someone to swap hands with. */
  | { readonly type: 'chooseSwapTarget'; readonly card: Card }
  /** Color Roulette: the victim must name the colour they will draw toward. */
  | { readonly type: 'chooseRouletteColor'; readonly victim: PlayerId }
  /** Game is over. */
  | { readonly type: 'gameOver'; readonly winner: PlayerId | null };

export interface GameState {
  readonly players: readonly Player[];
  /** Index into players[] whose turn it is. */
  readonly turn: number;
  readonly direction: Direction;

  readonly drawPile: readonly Card[];
  /** Last element is the top / active card. */
  readonly discardPile: readonly Card[];
  /** The colour currently in force. Differs from top card's colour after a wild. */
  readonly activeColor: Color | null;

  /**
   * Accumulated draw penalty from a stack of draw cards. 0 when no stack is
   * live. When > 0 the current player must either continue the stack with an
   * equal-or-higher draw card, or draw `pendingDraw` cards.
   */
  readonly pendingDraw: number;
  /** Draw value of the card on top of the live stack, for the equal-or-higher rule. */
  readonly stackValue: number;

  readonly phase: Phase;
  /** Seeded PRNG state. Advanced on every shuffle/draw. Never Math.random(). */
  readonly rng: number;
  readonly rules: RuleConfig;
  /** Monotonic counter, used to generate ids deterministically. */
  readonly seq: number;
}

export interface RuleConfig {
  /** Mercy Rule: hand size at which a player is eliminated. */
  readonly handLimit: number;
  readonly startingHand: number;
  /** 0 => everyone passes their hand in the direction of play. */
  readonly zeroPassesHands: boolean;
  /** 7 => swap hands with a player of your choice. */
  readonly sevenSwapsHands: boolean;
  /** Draw cards can be stacked onto an equal-or-lower draw card. */
  readonly stackingEnabled: boolean;
  /** Safety valve for the simulation harness; not a real UNO rule. */
  readonly maxTurns: number;
}

export const DEFAULT_RULES: RuleConfig = {
  handLimit: 25,
  startingHand: 7,
  zeroPassesHands: true,
  sevenSwapsHands: true,
  stackingEnabled: true,
  maxTurns: 5000,
};
