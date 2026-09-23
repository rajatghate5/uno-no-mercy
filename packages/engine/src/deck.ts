/**
 * Deck construction, driven entirely by config/deck.yml.
 *
 * The composition is NOT hardcoded. `buildDeck` takes a DeckSpec so that
 * verifying the real deck (Task 0) is a config edit, never a code change.
 * It refuses to build a deck whose counts don't sum to the declared total,
 * which turns a silent miscount into a startup error.
 */

import { COLORS, type Card, type CardKind, type Color } from './types.js';

export interface DeckSpec {
  total: number;
  colors: readonly Color[];
  perColor: {
    /** 0 is rarer than the other ranks: one per colour, not two. */
    zero: number;
    /** Copies of EACH rank 1-9. */
    numbers: number;
    drawTwo: number;
    skip: number;
    reverse: number;
    /** The COLOURED +4. Distinct from Wild Reverse Draw 4. */
    drawFour: number;
    skipEveryone: number;
    discardAll: number;
  };
  /**
   * Wild counts. Partial on purpose: No Mercy has no plain Wild Draw 4, so
   * that key is simply absent rather than set to zero.
   */
  wilds: Partial<{
    wild: number;
    wildDrawFour: number;
    wildDrawSix: number;
    wildDrawTen: number;
    wildReverseDrawFour: number;
    wildColorRoulette: number;
  }>;
}

/**
 * Default composition. Mirrors config/deck.yml.
 *
 * 37 per colour x 4 = 148, plus 20 wilds = 168.
 *
 * Note what is NOT here: a plain Wild Draw 4. No Mercy has a COLOURED +4 in
 * each suit and a Wild Reverse Draw 4, and no colourless plain +4.
 */
export const DEFAULT_DECK_SPEC: DeckSpec = {
  total: 168,
  colors: COLORS,
  perColor: {
    zero: 1,
    numbers: 2, // each of ranks 1-9
    drawTwo: 3,
    skip: 3,
    reverse: 3,
    drawFour: 3,
    skipEveryone: 3,
    discardAll: 3,
  },
  wilds: {
    wild: 4,
    wildDrawSix: 4,
    wildDrawTen: 4,
    wildReverseDrawFour: 4,
    wildColorRoulette: 4,
  },
};

export class DeckSpecError extends Error {}

/** Cards a spec will produce, without building them. Used for validation and by bots. */
export function deckSize(spec: DeckSpec): number {
  const p = spec.perColor;
  // ranks 1-9 at p.numbers each, plus however many zeros.
  const perColor =
    p.zero +
    p.numbers * 9 +
    p.drawTwo +
    p.skip +
    p.reverse +
    p.drawFour +
    p.skipEveryone +
    p.discardAll;
  const wilds = Object.values(spec.wilds).reduce((a, b) => a + (b ?? 0), 0);
  return perColor * spec.colors.length + wilds;
}

/**
 * Build the full deck in canonical (unshuffled) order.
 *
 * Throws if the spec doesn't sum to `total` — this is the guard that makes a
 * miscounted deck.yml fail loudly at startup instead of quietly skewing the
 * game for weeks.
 */
export function buildDeck(spec: DeckSpec = DEFAULT_DECK_SPEC): Card[] {
  const actual = deckSize(spec);
  if (actual !== spec.total) {
    throw new DeckSpecError(
      `Deck composition does not match declared total: counts sum to ${actual}, ` +
        `but total is ${spec.total}. Fix config/deck.yml (see Task 0 in the README).`,
    );
  }

  const cards: Card[] = [];
  let n = 0;
  const push = (kind: CardKind, color?: Color, rank?: number) => {
    cards.push({ id: `c${n++}`, kind, ...(color ? { color } : {}), ...(rank !== undefined ? { rank } : {}) });
  };

  for (const color of spec.colors) {
    for (let i = 0; i < spec.perColor.zero; i++) push('number', color, 0);
    for (let rank = 1; rank <= 9; rank++) {
      for (let i = 0; i < spec.perColor.numbers; i++) push('number', color, rank);
    }
    for (let i = 0; i < spec.perColor.drawTwo; i++) push('drawTwo', color);
    for (let i = 0; i < spec.perColor.skip; i++) push('skip', color);
    for (let i = 0; i < spec.perColor.reverse; i++) push('reverse', color);
    for (let i = 0; i < spec.perColor.drawFour; i++) push('drawFour', color);
    for (let i = 0; i < spec.perColor.skipEveryone; i++) push('skipEveryone', color);
    for (let i = 0; i < spec.perColor.discardAll; i++) push('discardAll', color);
  }

  for (const [kind, count] of Object.entries(spec.wilds) as [CardKind, number | undefined][]) {
    for (let i = 0; i < (count ?? 0); i++) push(kind);
  }

  return cards;
}
