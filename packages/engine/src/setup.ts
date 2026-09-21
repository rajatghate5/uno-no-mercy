/**
 * Game creation. Deterministic given a seed.
 */

import { buildDeck, DEFAULT_DECK_SPEC, type DeckSpec } from './deck.js';
import type { GameEvent } from './events.js';
import { shuffle } from './rng.js';
import {
  DEFAULT_RULES,
  isWild,
  type Card,
  type GameState,
  type Player,
  type RuleConfig,
} from './types.js';

export interface PlayerSpec {
  id: string;
  name: string;
  isBot: boolean;
}

export interface CreateOptions {
  players: readonly PlayerSpec[];
  seed: number;
  rules?: Partial<RuleConfig>;
  deck?: DeckSpec;
}

export function createGame(opts: CreateOptions): { state: GameState; events: GameEvent[] } {
  const rules: RuleConfig = { ...DEFAULT_RULES, ...opts.rules };
  const deck = buildDeck(opts.deck ?? DEFAULT_DECK_SPEC);

  const shuffled = shuffle(opts.seed, deck);
  let rng = shuffled.state;
  const pile = shuffled.value;

  const events: GameEvent[] = [
    { type: 'gameStarted', players: opts.players.map((p) => p.id), seed: opts.seed },
  ];

  const players: Player[] = opts.players.map((spec) => {
    const hand = pile.splice(0, rules.startingHand);
    events.push({ type: 'dealt', player: spec.id, count: hand.length });
    return { id: spec.id, name: spec.name, hand, eliminated: false, finished: false, isBot: spec.isBot };
  });

  /**
   * The starting card must be an ordinary card. Flipping a wild or an action
   * card as the opener would require resolving an effect before anyone has had
   * a turn, so we dig for the first number card and leave the rest in place.
   */
  let startIdx = pile.findIndex((c) => c.kind === 'number');
  if (startIdx < 0) startIdx = 0;
  const [start] = pile.splice(startIdx, 1) as [Card];

  const state: GameState = {
    players,
    turn: 0,
    direction: 1,
    drawPile: pile,
    discardPile: [start],
    activeColor: isWild(start.kind) ? null : (start.color ?? null),
    pendingDraw: 0,
    stackValue: 0,
    phase: { type: 'play' },
    rng,
    rules,
    seq: 0,
  };

  events.push({ type: 'turnChanged', player: players[0]!.id });
  return { state, events };
}
