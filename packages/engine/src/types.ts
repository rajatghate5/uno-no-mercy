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
  /**
   * A player who is down to one card and has not called UNO yet.
   *
   * Public information - everyone can see the hand counts anyway - and the
   * whole point is that opponents get the chance to catch them. Cleared when
   * they call, when someone catches them, or when their next turn comes round.
   */
  readonly unoRisk: PlayerId | null;
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
  /**
   * May the player who laid the 7 decline the swap and keep their hand?
   *
   * A house rule, and off in Mattel's sheet: there, playing a 7 obliges you
   * to swap with somebody. It exists because a 7 drawn into a hand you are
   * winning with is otherwise a card you simply cannot afford to play.
   */
  readonly sevenMayDecline: boolean;
  /** Draw cards can be stacked onto an equal-or-lower draw card. */
  readonly stackingEnabled: boolean;
  /**
   * How strict stacking is.
   *
   * 'escalating' is what Mattel's instruction sheet says: your card must equal
   *   or exceed THE LAST CARD PLAYED. "This continues until someone can't play
   *   a Draw Card that equals or exceeds the value of the last card played."
   * 'sum' is the stricter reading published by unorules.com, where you must
   *   equal or exceed the whole ACCUMULATED penalty. Stacks then die out fast,
   *   because two cards in are already past +10.
   * 'any' lets a +2 answer a +10. Not a real rule anywhere; it makes stacks
   *   survivable and sharply cuts eliminations.
   *
   * The two sources genuinely disagree, so both are offered and the printed
   * sheet wins the default.
   */
  readonly stackMode: 'escalating' | 'sum' | 'any';
  /**
   * Draw until you get something playable, rather than drawing exactly one
   * card and passing.
   *
   * This is the REAL No Mercy rule, not a house rule. The instruction sheet:
   * "If you DO NOT HAVE a matching card, you MUST draw cards from the Draw
   * Pile UNTIL YOU DRAW A CARD YOU CAN PLAY." Turning it off gives you
   * classic UNO's draw-one-and-pass, which is why it stays configurable.
   */
  readonly drawUntilPlayable: boolean;
  /**
   * If the card you draw can be played, it is played for you immediately.
   *
   * Also the real rule - the same sentence finishes "Then, play that card."
   * It pairs with drawUntilPlayable by design: together they turn a draw into
   * "keep going until something lands, then play it", which is why both
   * default on and why hands in No Mercy grow in bursts.
   */
  readonly forcePlay: boolean;
  /**
   * Calling UNO on one card, and the 2-card penalty for being caught out.
   *
   * On by default - it is a printed rule - but the timing window has to be
   * interpreted for a digital table. See `unoRisk` in reduce.ts.
   */
  readonly unoCalls: boolean;
  /** Safety valve for the simulation harness; not a real UNO rule. */
  readonly maxTurns: number;
}

export const DEFAULT_RULES: RuleConfig = {
  handLimit: 25,
  startingHand: 7,
  zeroPassesHands: true,
  sevenSwapsHands: true,
  sevenMayDecline: true,
  stackingEnabled: true,
  stackMode: 'escalating',
  drawUntilPlayable: true,
  forcePlay: true,
  unoCalls: true,
  maxTurns: 5000,
};
