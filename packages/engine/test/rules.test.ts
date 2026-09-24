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
  DEFAULT_RULES,
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

  test('the composition matches Mattel\'s instruction sheet', () => {
    // Locked down per-type on purpose. Three different wrong specs have been
    // in this file, and every one of them summed to exactly 168 - the total
    // alone can never catch a miscount, only a per-type assertion can.
    //
    // Source of truth: service.mattel.com/instruction_sheets/HVW18-Eng.pdf
    const deck = buildDeck();
    const count = (fn: (c: Card) => boolean) => deck.filter(fn).length;

    // Numbers: TWO of every rank including 0, unlike standard UNO.
    for (let rank = 0; rank <= 9; rank++) {
      expect(count((c) => c.kind === 'number' && c.rank === rank)).toBe(8);
    }
    expect(count((c) => c.kind === 'number')).toBe(80);

    // Coloured actions: three of each, per colour.
    for (const kind of ['drawTwo', 'skip', 'reverse', 'drawFour', 'skipEveryone', 'discardAll']) {
      expect(count((c) => c.kind === kind)).toBe(12);
    }

    // Wilds: four types, four each.
    for (const kind of [
      'wildDrawSix',
      'wildDrawTen',
      'wildReverseDrawFour',
      'wildColorRoulette',
    ]) {
      expect(count((c) => c.kind === kind)).toBe(4);
    }

    // Neither a plain Wild nor a plain colourless +4 exists in No Mercy. The
    // instruction sheet's scoring table names exactly four wild cards, and
    // earlier specs here invented both of these.
    expect(count((c) => c.kind === 'wild')).toBe(0);
    expect(count((c) => c.kind === 'wildDrawFour')).toBe(0);

    // 38 per colour x 4 = 152 coloured, + 16 wilds.
    expect(count((c) => c.color !== undefined)).toBe(152);
    expect(count((c) => c.color === undefined)).toBe(16);
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

describe('rule variants', () => {
  test("stackMode 'any' lets a small draw card answer a big one", () => {
    const hand = [card('drawTwo', 'blue')];
    const escalating = state({
      players: [player('a', hand), player('b', [])],
      pendingDraw: 10,
      stackValue: 10,
      rules: { stackMode: 'escalating' },
    });
    // The real No Mercy rule: +2 cannot answer a +10.
    expect(legalMoves(escalating, 'a')).toHaveLength(0);

    const any = state({
      players: [player('a', hand), player('b', [])],
      pendingDraw: 10,
      stackValue: 10,
      rules: { stackMode: 'any' },
    });
    expect(legalMoves(any, 'a')).toHaveLength(1);
  });

  test("stackMode 'any' still refuses non-draw cards", () => {
    const s = state({
      players: [player('a', [num('red', 5), card('wild')]), player('b', [])],
      pendingDraw: 4,
      stackValue: 4,
      rules: { stackMode: 'any' },
    });
    expect(legalMoves(s, 'a')).toHaveLength(0);
  });

  test('drawUntilPlayable keeps drawing until something matches', () => {
    // Draw pile pops from the end: blue1 is unplayable on red, red3 is not.
    const s = state({
      players: [player('a', []), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('red', 3), num('blue', 1), num('blue', 2), num('blue', 4)],
      // forcePlay off, so the drawn red3 stays in hand and can be counted.
      rules: { drawUntilPlayable: true, forcePlay: false },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    // Drew blue4, blue2, blue1, then red3 - four cards.
    expect(r.state.players[0]!.hand).toHaveLength(4);
    expect(r.state.players[0]!.hand.at(-1)!.color).toBe('red');
  });

  test('drawUntilPlayable draws exactly one when that one is playable', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('blue', 9), num('red', 7)],
      rules: { drawUntilPlayable: true, forcePlay: false },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.state.players[0]!.hand).toHaveLength(1);
  });

  test('drawUntilPlayable stops at the mercy limit instead of eliminating you', () => {
    // Nothing in the pile is playable, so without a bound this would draw
    // until the deck ran dry and wipe the player out.
    const s = state({
      players: [player('a', pile(20, 'red')), player('b', [])],
      discardPile: [num('green', 5)],
      activeColor: 'green',
      drawPile: pile(40, 'blue'),
      rules: { drawUntilPlayable: true, handLimit: 25 },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    const a = r.state.players[0]!;
    // Either it stopped at the limit, or the limit tripped and eliminated it -
    // but it must not have drawn the whole pile.
    expect(a.eliminated || a.hand.length <= 25).toBe(true);
    expect(r.state.drawPile.length).toBeGreaterThan(10);
  });

  test('forcePlay plays the drawn card when it is playable', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('red', 7)],
      rules: { forcePlay: true },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    // Drawn and immediately played, so the hand is empty and the 7 is on top.
    expect(r.state.players[0]!.hand).toHaveLength(0);
    expect(r.state.discardPile.at(-1)!.rank).toBe(7);
  });

  test('forcePlay leaves an unplayable card in hand and passes the turn', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('blue', 9)],
      rules: { forcePlay: true },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.players[r.state.turn]!.id).toBe('b');
  });

  test('forcePlay on a drawn wild still asks for a colour', () => {
    const s = state({
      // Needs a spare card: emptying your hand WINS, and the game ending is a
      // different (correct) outcome that would hide the colour prompt.
      players: [player('a', [num('green', 2)]), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [card('wild')],
      rules: { forcePlay: true },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.state.phase.type).toBe('chooseColor');
  });

  test('forcePlay that empties your hand wins the game', () => {
    const s = state({
      players: [player('a', []), player('b', [num('blue', 1)])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('red', 7)],
      rules: { forcePlay: true },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.state.phase).toMatchObject({ type: 'gameOver', winner: 'a' });
  });

  test('forcePlay does not act for a player the draw just eliminated', () => {
    const s = state({
      players: [player('a', pile(24, 'red')), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('red', 7)],
      rules: { forcePlay: true, handLimit: 25 },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    expect(r.state.players[0]!.eliminated).toBe(true);
  });

  test('forcePlay and drawUntilPlayable combine into draw-then-play', () => {
    const s = state({
      players: [player('a', []), player('b', [])],
      discardPile: [num('red', 5)],
      activeColor: 'red',
      drawPile: [num('red', 3), num('blue', 1), num('blue', 2)],
      rules: { forcePlay: true, drawUntilPlayable: true },
    });
    const r = reduce(s, { type: 'draw', player: 'a' });
    // Drew blue2, blue1, red3 - then played the red3.
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.discardPile.at(-1)!.rank).toBe(3);
  });

  test("stackMode 'sum' measures against the running total, not the last card", () => {
    // unorules.com's reading: after +2 then +4 the next player owes 6, so only
    // a +6 or +10 continues it. Under the printed rule a +4 would be enough.
    const plusFour = card('drawFour', 'blue');
    const plusSix = card('wildDrawSix');
    const s = state({
      players: [player('a', [plusFour, plusSix, num('red', 1)]), player('b', [])],
      pendingDraw: 6,
      stackValue: 4,
      rules: { stackMode: 'sum' },
    });
    expect(legalMoves(s, 'a').map((c) => c.id)).toEqual([plusSix.id]);

    // Same position, printed rule: the +4 matches the last card and is legal.
    const printed = state({
      players: [player('a', [plusFour, plusSix, num('red', 1)]), player('b', [])],
      pendingDraw: 6,
      stackValue: 4,
      rules: { stackMode: 'escalating' },
    });
    expect(legalMoves(printed, 'a').map((c) => c.id)).toEqual([plusFour.id, plusSix.id]);
  });

  test('default rules keep the real No Mercy behaviour', () => {
    expect(DEFAULT_RULES.stackMode).toBe('escalating');
    // Both of these are printed rules, not house rules: "you MUST draw cards
    // from the Draw Pile UNTIL YOU DRAW A CARD YOU CAN PLAY. Then, play that
    // card." They were shipped defaulting off, which quietly made the game
    // classic UNO's draw-one-and-pass.
    expect(DEFAULT_RULES.drawUntilPlayable).toBe(true);
    expect(DEFAULT_RULES.forcePlay).toBe(true);
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

  test('Wild Reverse Draw 4 backfires onto its player with only two left', () => {
    // "With just two players this card skips the other player and makes YOU
    // draw 4 cards!" The turn must therefore stay put.
    const wrd4 = card('wildReverseDrawFour');
    const s = state({
      players: [player('a', [wrd4, num('blue', 1)]), player('b', [num('green', 2)])],
      activeColor: 'red',
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: wrd4.id });
    const colored = reduce(played.state, { type: 'chooseColor', player: 'a', color: 'blue' });

    expect(colored.state.pendingDraw).toBe(4);
    // Still a's problem, not b's.
    expect(colored.state.players[colored.state.turn]!.id).toBe('a');
    expect(colored.state.phase.type).toBe('play');
  });

  test('a backfired Wild Reverse Draw 4 can be stacked back across the table', () => {
    // "You may use the stacking rule to send the penalty back to the other
    // player." A +4 answers a +4, so the plain coloured +4 is enough.
    const wrd4 = card('wildReverseDrawFour');
    const plusFour = card('drawFour', 'blue');
    const s = state({
      // The filler matters: with only wrd4 and the +4 in hand, playing the +4
      // empties the hand and a WINS instead of stacking.
      players: [player('a', [wrd4, plusFour, num('red', 1)]), player('b', [num('green', 2)])],
      activeColor: 'red',
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: wrd4.id });
    const colored = reduce(played.state, { type: 'chooseColor', player: 'a', color: 'blue' });
    // A live stack allows only draw cards, so the red 1 is not an option.
    expect(legalMoves(colored.state, 'a').map((c) => c.id)).toEqual([plusFour.id]);

    const sent = reduce(colored.state, { type: 'play', player: 'a', cardId: plusFour.id });
    expect(sent.state.pendingDraw).toBe(8);
    expect(sent.state.players[sent.state.turn]!.id).toBe('b');
  });

  test('Color Roulette makes the victim draw until the named colour appears', () => {
    const roulette = card('wildColorRoulette');
    const drawPile: Card[] = [num('green', 1), num('red', 2), num('blue', 3), num('blue', 4)];
    const s = state({
      players: [player('a', [roulette, num('blue', 1)]), player('b', []), player('c', [])],
      // pop() takes from the end, so 'b' draws blue4, blue3, red2, then green1.
      drawPile,
    });
    // The player who plays it does NOT name a colour - the victim does, and
    // that goes straight to the roulette phase.
    const played = reduce(s, { type: 'play', player: 'a', cardId: roulette.id });
    expect(played.state.phase).toMatchObject({ type: 'chooseRouletteColor', victim: 'b' });

    const done = reduce(played.state, { type: 'chooseRouletteColor', player: 'b', color: 'green' });
    // Drew until green appeared: blue4, blue3, red2, green1 => 4 cards.
    expect(done.state.players[1]!.hand).toHaveLength(4);
    expect(done.state.players[1]!.hand.at(-1)!.color).toBe('green');
    // The colour the victim named is the one left in play.
    expect(done.state.activeColor).toBe('green');
    // And they lose their turn, so play resumes with 'c'.
    expect(done.state.players[done.state.turn]!.id).toBe('c');
  });

  test('Color Roulette terminates instead of hanging when the deck runs dry', () => {
    const roulette = card('wildColorRoulette');
    const s = state({
      players: [player('a', [roulette, num('blue', 1)]), player('b', []), player('c', [])],
      drawPile: [num('blue', 3)],
      discardPile: [num('red', 5)],
    });
    const played = reduce(s, { type: 'play', player: 'a', cardId: roulette.id });
    // No green exists anywhere; this must stop, not loop forever.
    const done = reduce(played.state, { type: 'chooseRouletteColor', player: 'b', color: 'green' });
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
      // This test is about the pile, not about what happens to the card, so
      // keep the drawn card in hand rather than letting forcePlay play it.
      rules: { drawUntilPlayable: false, forcePlay: false },
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
