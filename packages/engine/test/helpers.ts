/** Builders for constructing exact game states in tests. */
import {
  DEFAULT_RULES,
  type Card,
  type CardKind,
  type Color,
  type GameState,
  type Player,
  type RuleConfig,
} from '@uno/engine';

let uid = 0;
export function card(kind: CardKind, color?: Color, rank?: number): Card {
  return { id: `t${uid++}`, kind, ...(color ? { color } : {}), ...(rank !== undefined ? { rank } : {}) };
}

export const num = (color: Color, rank: number) => card('number', color, rank);

export function player(id: string, hand: Card[], over: Partial<Player> = {}): Player {
  return { id, name: id, hand, eliminated: false, finished: false, isBot: true, ...over };
}

export function state(over: Partial<GameState> & { players: Player[] }): GameState {
  const rules: RuleConfig = { ...DEFAULT_RULES, ...(over.rules ?? {}) };
  return {
    turn: 0,
    direction: 1,
    drawPile: [],
    discardPile: [num('red', 5)],
    activeColor: 'red',
    pendingDraw: 0,
    stackValue: 0,
    phase: { type: 'play' },
    rng: 12345,
    seq: 0,
    ...over,
    rules,
  };
}

/** Fill a draw pile with n distinct cards of a given colour. */
export function pile(n: number, color: Color = 'blue'): Card[] {
  return Array.from({ length: n }, (_, i) => num(color, i % 10));
}
