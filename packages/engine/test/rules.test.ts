/**
 * Rule tests — one per mechanic, plus the edge cases that are easy to get
 * wrong and invisible when you do.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildDeck,
  canPlay,
  createGame,
  DeckSpecError,
  deckSize,
  DEFAULT_DECK_SPEC,
  legalMoves,
  redactFor,
  reduce,
  type Card,
} from '@uno/engine';
import { card, num, pile, player, state } from './helpers.js';

describe('deck', () => {
  test('default spec sums to its declared total', () => {
    expect(deckSize(DEFAULT_DECK_SPEC)).toBe(DEFAULT_DECK_SPEC.total);
    expect(buildDeck().length).toBe(168);
  });

  test('a miscounted spec fails loudly instead of silently skewing the game', () => {
    const bad = { ...DEFAULT_DECK_SPEC, total: 170 };
    expect(() => buildDeck(bad)).toThrow(DeckSpecError);
  });

  test('the composition matches the verified No Mercy deck', () => {
    // Locked down after finding SEVEN of fourteen counts wrong. Both the old
    // and new specs summed to 168, so the total alone never caught it - only
    // a per-type assertion can.
    const deck = buildDeck();
    const count = (fn: (c: Card) => boolean) => deck.filter(fn).length;

    // Numbers: 0 is rarer than the rest - one per colour, not two.
    expect(count((c) => c.kind === 'number' && c.rank === 0)).toBe(4);
    for (let rank = 1; rank <= 9; rank++) {
      expect(count((c) => c.kind === 'number' && c.rank === rank)).toBe(8);
    }
    expect(count((c) => c.kind === 'number')).toBe(76);

    // Coloured actions: three of each, per colour.
    for (const kind of ['drawTwo', 'skip', 'reverse', 'drawFour', 'skipEveryone', 'discardAll']) {
      expect(count((c) => c.kind === kind)).toBe(12);
    }

    // Wilds: five types, four each.
    for (const kind of [
      'wild',
      'wildDrawSix',
      'wildDrawTen',
      'wildReverseDrawFour',
      'wildColorRoulette',
    ]) {
      expect(count((c) => c.kind === kind)).toBe(4);
    }

    // No Mercy has a COLOURED +4 and a Wild Reverse Draw 4, but no plain
    // colourless +4. An earlier spec invented four of them.
    expect(count((c) => c.kind === 'wildDrawFour')).toBe(0);

    expect(deck.length).toBe(168);
  });

  test('every card has a unique id', () => {
    const deck = buildDeck();
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });
});

describe('stacking', () => {
  test('equal or higher draw value may be stacked, lower may not', () => {
    const s = state({
      players: [player('a', [card('drawTwo', 'blue'), card('wildDrawSix'), card('drawFour', 'red')])],
      pendingDraw: 4,
      stackValue: 4,
      discardPile: [card('drawFour', 'green')],
      activeColor: 'green',
    });
    const playable = legalMoves(s, 'a').map((c) => c.kind);
    expect(playable).toContain('wildDrawSix'); // 6 >= 4
    expect(playable).toContain('drawFour'); // 4 >= 4
    expect(playable).not.toContain('drawTwo'); // 2 < 4
  });

  test('colour is irrelevant while a stack is live', () => {
    const s = state({
      players: [player('a', [card('drawTwo', 'blue')])],
      pendingDraw: 2,
      stackValue: 2,
      discardPile: [card('drawTwo', 'red')],
      activeColor: 'red',
    });
    expect(legalMoves(s, 'a')).toHaveLength(1);
  });

  test('Color Roulette can never join a stack', () => {
    const s = state({
      players: [player('a', [card('wildColorRoulette')])],
      pendingDraw: 2,
      stackValue: 2,
    });
    expect(legalMoves(s, 'a')).toHaveLength(0);
  });

  test('non-draw cards cannot answer a stack', () => {
    const s = state({
      players: [player('a', [num('red', 5), card('skip', 'red'), card('wild')])],
      pendingDraw: 2,
      stackValue: 2,
      activeColor: 'red',
    });
    expect(legalMoves(s, 'a')).toHaveLength(0);
  });

  test('taking the stack draws the full accumulated amount and ends the turn', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      pendingDraw: 10,
      stackValue: 10,
      drawPile: pile(20),
    });
    const r = reduce(s, { type: 'takeStack', player: 'a' });
    expect(r.state.players[0]!.hand).toHaveLength(10);
    expect(r.state.pendingDraw).toBe(0);
    expect(r.state.players[r.state.turn]!.id).toBe('b');
  });
});

describe('mercy rule', () => {
  test('a hand reaching the limit eliminates its owner', () => {
    const s = state({
      players: [player('a', pile(24, 'red')), player('b', [])],
      pendingDraw: 1,
      stackValue: 1,
      drawPile: pile(10),
    });
    const r = reduce(s, { type: 'takeStack', player: 'a' });
    expect(r.state.players[0]!.eliminated).toBe(true);
    expect(r.events.some((e) => e.type === 'eliminated')).toBe(true);
  });

  test('an eliminated hand is recycled, not frozen (card conservation)', () => {
    const s = state({
      players: [player('a', pile(24, 'red')), player('b', [num('blue', 1)]), player('c', [])],
      pendingDraw: 1,
      stackValue: 1,
      drawPile: pile(10),
    });
    const before =
      s.players.reduce((n, p) => n + p.hand.length, 0) + s.drawPile.length + s.discardPile.length;
    const r = reduce(s, { type: 'takeStack', player: 'a' });
    const after =
      r.state.players.reduce((n, p) => n + p.hand.length, 0) +
      r.state.drawPile.length +
      r.state.discardPile.length;
    expect(after).toBe(before);
    expect(r.state.players[0]!.hand).toHaveLength(0);
  });

  test('a stack big enough eliminates a player mid-resolution', () => {
    const s = state({
      players: [player('a', pile(20, 'red')), player('b', [])],
      pendingDraw: 10,
      stackValue: 10,
      drawPile: pile(30),
    });
    const r = reduce(s, { type: 'takeStack', player: 'a' });
    expect(r.state.players[0]!.eliminated).toBe(true);
    // Last player standing wins immediately.
    expect(r.state.phase).toMatchObject({ type: 'gameOver', winner: 'b' });
  });
});

describe('special cards', () => {
  test('Skip Everyone returns the turn to the player who played it', () => {
    const s = state({
      players: [player('a', [card('skipEveryone', 'red'), num('blue', 1)]), player('b', []), player('c', [])],
      activeColor: 'red',
    });
    const cardId = s.players[0]!.hand[0]!.id;
    const r = reduce(s, { type: 'play', player: 'a', cardId });
    expect(r.state.players[r.state.turn]!.id).toBe('a');
    expect(r.events.some((e) => e.type === 'everyoneSkipped')).toBe(true);
  });

  test('Skip Everyone in a two-player game still returns the turn', () => {
    const s = state({
      players: [player('a', [card('skipEveryone', 'red'), num('blue', 1)]), player('b', [num('red', 3)])],
      activeColor: 'red',
    });
    const cardId = s.players[0]!.hand[0]!.id;
    const r = reduce(s, { type: 'play', player: 'a', cardId });
    expect(r.state.players[r.state.turn]!.id).toBe('a');
  });

  test('reverse acts as a skip with two players', () => {
    const s = state({
      players: [player('a', [card('reverse', 'red'), num('blue', 1)]), player('b', [num('red', 3)])],
      activeColor: 'red',
    });
    const cardId = s.players[0]!.hand[0]!.id;
    const r = reduce(s, { type: 'play', player: 'a', cardId });
    expect(r.state.players[r.state.turn]!.id).toBe('a');
  });

  test('Discard All dumps every card of that colour', () => {
    const hand = [card('discardAll', 'red'), num('red', 1), num('red', 9), num('blue', 4)];
    const s = state({ players: [player('a', hand), player('b', [])], activeColor: 'red' });
    const r = reduce(s, { type: 'play', player: 'a', cardId: hand[0]!.id });
    expect(r.state.players[0]!.hand.map((c) => c.color)).toEqual(['blue']);
    expect(r.events.some((e) => e.type === 'discardedAll' && e.count === 2)).toBe(true);
  });

  test('a 0 passes every hand in the direction of play', () => {
    const zero = num('red', 0);
    const s = state({
      players: [
        player('a', [zero, num('blue', 1)]),
        player('b', [num('green', 2), num('green', 3)]),
        player('c', [num('yellow', 4)]),
      ],
      activeColor: 'red',
    });
    const r = reduce(s, { type: 'play', player: 'a', cardId: zero.id });
    // a played the 0, so a holds one card; that hand moves to b.
    expect(r.state.players[1]!.hand.map((c) => c.color)).toEqual(['blue']);
    expect(r.state.players[2]!.hand.map((c) => c.color)).toEqual(['green', 'green']);
    expect(r.state.players[0]!.hand.map((c) => c.color)).toEqual(['yellow']);
  });

  test('a 7 asks for a swap target, then swaps hands', () => {
    const seven = num('red', 7);
    const s = state({
      players: [player('a', [seven, num('blue', 1)]), player('b', [num('green', 2), num('green', 3)])],
      activeColor: 'red',
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: seven.id });
    expect(played.state.phase.type).toBe('chooseSwapTarget');

    const swapped = reduce(played.state, { type: 'chooseSwapTarget', player: 'a', target: 'b' });
    expect(swapped.state.players[0]!.hand.map((c) => c.color)).toEqual(['green', 'green']);
    expect(swapped.state.players[1]!.hand.map((c) => c.color)).toEqual(['blue']);
  });

  test('Wild Reverse Draw 4 both reverses and stacks', () => {
    const wrd4 = card('wildReverseDrawFour');
    const s = state({
      players: [player('a', [wrd4, num('blue', 1)]), player('b', []), player('c', [])],
    });
    const r = reduce(s, { type: 'play', player: 'a', cardId: wrd4.id });
    expect(r.state.direction).toBe(-1);
    expect(r.state.pendingDraw).toBe(4);
    expect(r.state.phase.type).toBe('chooseColor');
  });

  test('Color Roulette makes the victim draw until the named colour appears', () => {
    const roulette = card('wildColorRoulette');
    const drawPile: Card[] = [num('green', 1), num('red', 2), num('blue', 3), num('blue', 4)];
    const s = state({
      players: [player('a', [roulette, num('blue', 1)]), player('b', []), player('c', [])],
      // pop() takes from the end, so 'b' draws blue4, blue3, red2, then green1.
      drawPile,
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: roulette.id });
    const colored = reduce(played.state, { type: 'chooseColor', player: 'a', color: 'red' });
    expect(colored.state.phase).toMatchObject({ type: 'chooseRouletteColor', victim: 'b' });

    const done = reduce(colored.state, { type: 'chooseRouletteColor', player: 'b', color: 'green' });
    // Drew until green appeared: blue4, blue3, red2, green1 => 4 cards.
    expect(done.state.players[1]!.hand).toHaveLength(4);
    expect(done.state.players[1]!.hand.at(-1)!.color).toBe('green');
  });

  test('Color Roulette terminates instead of hanging when the deck runs dry', () => {
    const roulette = card('wildColorRoulette');
    const s = state({
      players: [player('a', [roulette, num('blue', 1)]), player('b', []), player('c', [])],
      drawPile: [num('blue', 3)],
      discardPile: [num('red', 5)],
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: roulette.id });
    const colored = reduce(played.state, { type: 'chooseColor', player: 'a', color: 'red' });
    // No green exists anywhere; this must stop, not loop forever.
    const done = reduce(colored.state, { type: 'chooseRouletteColor', player: 'b', color: 'green' });
    expect(done.state.phase.type).not.toBe('chooseRouletteColor');
  });
});

describe('draw pile', () => {
  test('reshuffles the discard pile when exhausted, keeping the top card', () => {
    const top = num('red', 5);
    const s = state({
      players: [player('a', []), player('b', [])],
      drawPile: [],
      discardPile: [...pile(12, 'green'), top],
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.events.some((e) => e.type === 'reshuffled')).toBe(true);
    expect(r.state.discardPile.at(-1)!.id).toBe(top.id);
    expect(r.state.players[0]!.hand).toHaveLength(1);
  });

  test('a draw with nothing left to recycle draws fewer cards rather than hanging', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      drawPile: [],
      discardPile: [num('red', 5)],
      pendingDraw: 6,
      stackValue: 6,
    });
    const r = reduce(s, { type: 'takeStack', player: 'a' });
    expect(r.state.players[0]!.hand).toHaveLength(0);
    expect(r.state.pendingDraw).toBe(0);
  });
});

describe('winning', () => {
  test('playing your last card wins immediately', () => {
    const last = num('red', 3);
    const s = state({ players: [player('a', [last]), player('b', [num('blue', 1)])], activeColor: 'red' });
    const r = reduce(s, { type: 'play', player: 'a', cardId: last.id });
    expect(r.state.phase).toMatchObject({ type: 'gameOver', winner: 'a' });
  });

  test('emptying your hand via Discard All also wins', () => {
    const da = card('discardAll', 'red');
    const s = state({
      players: [player('a', [da, num('red', 1), num('red', 2)]), player('b', [num('blue', 1)])],
      activeColor: 'red',
    });
    const r = reduce(s, { type: 'play', player: 'a', cardId: da.id });
    expect(r.state.phase).toMatchObject({ type: 'gameOver', winner: 'a' });
  });
});

describe('redaction (anti-cheat)', () => {
  test('never leaks another hand, the draw pile, or the RNG', () => {
    const { state: s } = createGame({
      seed: 7,
      players: [
        { id: 'a', name: 'A', isBot: false },
        { id: 'b', name: 'B', isBot: true },
      ],
    });
    const view = redactFor(s, 'a');

    expect(view.players.find((p) => p.id === 'a')!.hand).toHaveLength(7);
    expect(view.players.find((p) => p.id === 'b')!.hand).toBeUndefined();
    expect(view.players.find((p) => p.id === 'b')!.handCount).toBe(7);

    // The serialised payload must not contain the opponent's card ids or the seed.
    const wire = JSON.stringify(view);
    for (const c of s.players[1]!.hand) expect(wire).not.toContain(`"${c.id}"`);
    expect(wire).not.toContain('"rng"');
    expect(wire).not.toContain('"drawPile"');
  });

  test('a spectator sees no hand at all', () => {
    const { state: s } = createGame({
      seed: 9,
      players: [
        { id: 'a', name: 'A', isBot: false },
        { id: 'b', name: 'B', isBot: true },
      ],
    });
    const view = redactFor(s, '__spectator__');
    expect(view.players.every((p) => p.hand === undefined)).toBe(true);
    expect(view.players.every((p) => p.handCount === 7)).toBe(true);
  });
});

describe('determinism', () => {
  test('the same seed produces an identical deal', () => {
    const mk = () =>
      createGame({
        seed: 4242,
        players: [
          { id: 'a', name: 'A', isBot: true },
          { id: 'b', name: 'B', isBot: true },
        ],
      });
    expect(JSON.stringify(mk().state)).toBe(JSON.stringify(mk().state));
  });

  test('different seeds produce different deals', () => {
    const mk = (seed: number) =>
      createGame({ seed, players: [{ id: 'a', name: 'A', isBot: true }] });
    expect(JSON.stringify(mk(1).state)).not.toBe(JSON.stringify(mk(2).state));
  });

  test('the opening card is never a wild or an action card', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state: s } = createGame({ seed, players: [{ id: 'a', name: 'A', isBot: true }] });
      expect(s.discardPile[0]!.kind).toBe('number');
    }
  });
});

describe('illegal actions', () => {
  test('playing out of turn is rejected', () => {
    const s = state({ players: [player('a', [num('red', 1)]), player('b', [num('red', 2)])] });
    const cardId = s.players[1]!.hand[0]!.id;
    expect(() => reduce(s, { type: 'play', player: 'b', cardId })).toThrow();
  });

  test('drawing normally while a stack is live is rejected', () => {
    const s = state({ players: [player('a', []), player('b', [])], pendingDraw: 4, stackValue: 4 });
    expect(() => reduce(s, { type: 'draw', player: 'a' })).toThrow();
  });

  test('an unplayable card is rejected', () => {
    const blue = num('blue', 9);
    const s = state({
      players: [player('a', [blue]), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
    });
    expect(canPlay(s, blue)).toBe(false);
    expect(() => reduce(s, { type: 'play', player: 'a', cardId: blue.id })).toThrow();
  });
});
