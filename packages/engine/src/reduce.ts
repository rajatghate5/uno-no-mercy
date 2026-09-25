/**
 * The reducer: the only place game state changes.
 *
 * Pure. `reduce(state, action) -> { state, events }`. No I/O, no clock, no
 * Math.random. Every randomness draw goes through state.rng.
 */

import type { GameEvent, GameOverReason } from './events.js';
import { canPlay, isLegalAction, topCard, type Action } from './legal.js';
import { shuffle } from './rng.js';
import {
  drawValue,
  isDrawCard,
  isWild,
  type Card,
  type Color,
  type GameState,
  type Player,
  type PlayerId,
} from './types.js';

export class IllegalActionError extends Error {}

/** Mutable working copy, converted back to a readonly GameState on the way out. */
interface Draft {
  players: Player[];
  turn: number;
  direction: 1 | -1;
  drawPile: Card[];
  discardPile: Card[];
  activeColor: Color | null;
  pendingDraw: number;
  stackValue: number;
  phase: GameState['phase'];
  unoRisk: PlayerId | null;
  rng: number;
  rules: GameState['rules'];
  seq: number;
}

function toDraft(s: GameState): Draft {
  return {
    players: s.players.map((p) => ({ ...p, hand: [...p.hand] })),
    turn: s.turn,
    direction: s.direction,
    drawPile: [...s.drawPile],
    discardPile: [...s.discardPile],
    activeColor: s.activeColor,
    pendingDraw: s.pendingDraw,
    stackValue: s.stackValue,
    phase: s.phase,
    unoRisk: s.unoRisk,
    rng: s.rng,
    rules: s.rules,
    seq: s.seq,
  };
}

const isActive = (p: Player) => !p.eliminated && !p.finished;

function activeCount(d: Draft): number {
  return d.players.filter(isActive).length;
}

/**
 * Refill the draw pile from the discard pile, keeping the top card in play.
 *
 * Returns false when there is nothing to recycle — the deck is genuinely
 * exhausted. Callers must handle that rather than loop forever; it is the
 * difference between "draw 10" quietly drawing 3 and the game hanging.
 */
function reshuffle(d: Draft, events: GameEvent[]): boolean {
  if (d.discardPile.length <= 1) return false;
  const top = d.discardPile[d.discardPile.length - 1]!;
  const recycled = d.discardPile.slice(0, -1);
  const r = shuffle(d.rng, recycled);
  d.rng = r.state;
  d.drawPile = r.value;
  d.discardPile = [top];
  events.push({ type: 'reshuffled', count: r.value.length });
  return true;
}

/** Draw up to `count` cards. Returns how many were actually drawn. */
function drawCards(d: Draft, playerIdx: number, count: number, events: GameEvent[]): number {
  const player = d.players[playerIdx]!;
  const hand = [...player.hand];
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (d.drawPile.length === 0 && !reshuffle(d, events)) break;
    const card = d.drawPile.pop();
    if (!card) break;
    hand.push(card);
    drawn++;
  }
  d.players[playerIdx] = { ...player, hand };
  if (drawn > 0) events.push({ type: 'drew', player: player.id, count: drawn });
  return drawn;
}

/**
 * Mercy Rule. A hand at or above the limit eliminates its owner immediately.
 *
 * The eliminated hand is recycled UNDER the top discard rather than kept in
 * the player's hand: leaving 25+ cards frozen in a dead hand can starve the
 * draw pile and stall the game. Recycling also keeps card conservation exact.
 */
function applyMercy(d: Draft, events: GameEvent[]): void {
  for (let i = 0; i < d.players.length; i++) {
    const p = d.players[i]!;
    if (!isActive(p)) continue;
    if (p.hand.length < d.rules.handLimit) continue;

    events.push({ type: 'eliminated', player: p.id, handSize: p.hand.length });
    const top = d.discardPile[d.discardPile.length - 1];
    const rest = d.discardPile.slice(0, -1);
    d.discardPile = top ? [...rest, ...p.hand, top] : [...p.hand];
    d.players[i] = { ...p, hand: [], eliminated: true };
  }
}

/** Next active seat from `from`, moving `steps` positions in `dir`. */
function nextActive(d: Draft, from: number, steps = 1): number {
  const n = d.players.length;
  let idx = from;
  let moved = 0;
  // Bounded by n * steps so a table with no active players can't spin forever.
  for (let guard = 0; guard < n * (steps + 1) + n; guard++) {
    idx = (idx + d.direction + n) % n;
    if (isActive(d.players[idx]!)) {
      moved++;
      if (moved === steps) return idx;
    }
  }
  return from;
}

/** No cards in the draw pile and nothing in the discard left to recycle. */
function deckDry(d: Draft): boolean {
  return d.drawPile.length === 0 && d.discardPile.length <= 1;
}

/**
 * Whoever is holding the smallest hand.
 *
 * Preference order matters: someone still in the game beats someone who has
 * been eliminated, however few cards the eliminated player was holding. Ties
 * go to the earlier seat, which is arbitrary but at least deterministic, and
 * a tie here means two players genuinely finished level.
 */
function smallestHand(d: Draft): PlayerId | null {
  const pool = d.players.filter(isActive);
  const contenders = pool.length > 0 ? pool : d.players;
  let best = contenders[0];
  if (!best) return null;
  for (const p of contenders) if (p.hand.length < best.hand.length) best = p;
  return best.id;
}

function finish(d: Draft, winner: PlayerId | null, reason: GameOverReason, events: GameEvent[]): void {
  d.phase = { type: 'gameOver', winner };
  events.push({ type: 'gameOver', winner, reason });
}

function endIfOver(d: Draft, events: GameEvent[]): boolean {
  const active = d.players.filter(isActive);
  const finished = d.players.find((p) => p.finished);

  if (finished) {
    finish(d, finished.id, 'wentOut', events);
    return true;
  }
  if (active.length <= 1) {
    /*
     * There is normally one player left standing, but a stack resolution can
     * push the last two over the hand limit at the same instant and leave
     * nobody active at all. That used to report a winner of null, which the
     * game-over screen rendered as "Nobody wins" - a result nobody at the
     * table would accept. Fall back to whoever was holding least.
     */
    const winner = active[0]?.id ?? smallestHand(d);
    finish(d, winner, active.length === 1 ? 'lastStanding' : 'fewestCards', events);
    return true;
  }
  return false;
}

/**
 * Settle a game that has run out of cards.
 *
 * The deck recycles the discard pile, so this only fires when the players are
 * between them holding very nearly all 168 cards AND the player to act cannot
 * play any of theirs. Before this existed the game simply stopped: no winner,
 * no message, and a table waiting on a turn that could never be taken.
 *
 * Deliberately narrower than "the deck is empty". A dry deck on its own is
 * not a reason to stop a game people can still play out; the deadlock is.
 */
function settleIfDeadlocked(d: Draft, events: GameEvent[]): void {
  if (d.phase.type === 'gameOver' || !deckDry(d)) return;
  const current = d.players[d.turn];
  if (!current || !isActive(current)) return;
  if (current.hand.some((c) => canPlay(d as unknown as GameState, c))) return;
  events.push({ type: 'deckExhausted' });
  finish(d, smallestHand(d), 'fewestCards', events);
}

/** Hand the turn to the next active player (or `steps` further, to skip). */
function advance(d: Draft, events: GameEvent[], steps = 1): void {
  if (endIfOver(d, events)) return;
  d.turn = nextActive(d, d.turn, steps);
  d.phase = { type: 'play' };
  events.push({ type: 'turnChanged', player: d.players[d.turn]!.id });
}

/** Everyone passes their whole hand to the next active player. Triggered by a 0. */
function passHands(d: Draft, events: GameEvent[]): void {
  const seats = d.players.map((p, i) => ({ p, i })).filter(({ p }) => isActive(p));
  if (seats.length < 2) return;
  const hands = seats.map(({ p }) => p.hand);
  for (let k = 0; k < seats.length; k++) {
    // Direction 1 => my hand goes to the next seat, so I receive the previous one.
    const src = d.direction === 1 ? (k - 1 + seats.length) % seats.length : (k + 1) % seats.length;
    const seat = seats[k]!;
    d.players[seat.i] = { ...seat.p, hand: [...hands[src]!] };
  }
  events.push({ type: 'handsPassed', direction: d.direction });
}

/** Mark a player finished if they have just emptied their hand. */
function checkFinished(d: Draft, idx: number, events: GameEvent[]): boolean {
  const p = d.players[idx]!;
  if (p.hand.length > 0) return false;
  d.players[idx] = { ...p, finished: true };
  events.push({ type: 'finished', player: p.id });
  return true;
}

/**
 * Open or close the "they are on one card and have not said it" window.
 *
 * The printed rule is a race: "if someone catches you and calls out UNO
 * before you (and before the next player begins their turn), then you must
 * draw 2 cards!"
 *
 * That window is a fraction of a second at a physical table. Here it is held
 * open until the at-risk player's OWN next turn comes round, because a table
 * where the window shuts the instant a bot moves is not a race anyone can
 * win - it just taxes whoever is slowest with a mouse. Everything else about
 * the rule is intact: you are only punished if somebody actually catches you.
 */
function updateUnoRisk(d: Draft, events: GameEvent[]): void {
  if (!d.rules.unoCalls) return;

  // The window closes when the player at risk gets to act again.
  if (d.unoRisk !== null && d.players[d.turn]?.id === d.unoRisk) {
    d.unoRisk = null;
  }

  if (d.unoRisk !== null) return;

  // Opens for whoever is sitting on exactly one card and is not the player
  // about to act - they have already got away with it if it is their turn.
  for (const p of d.players) {
    if (!isActive(p) || p.hand.length !== 1) continue;
    if (p.id === d.players[d.turn]?.id) continue;
    d.unoRisk = p.id;
    events.push({ type: 'unoRisked', player: p.id });
    return;
  }
}

/**
 * Does this card's penalty land back on the player who played it?
 *
 * Only one card does: Wild Reverse Draw 4 with exactly two players left. From
 * the instruction sheet: "With just two players this card skips the other
 * player and makes YOU draw 4 cards! You may use the stacking rule to send
 * the penalty back to the other player."
 *
 * So the turn does NOT move on. The player who played it is now facing their
 * own +4 and must either take it or stack a +4-or-higher on top, which is
 * what sends it across the table.
 */
function backfires(d: Draft, card: Card): boolean {
  return card.kind === 'wildReverseDrawFour' && activeCount(d) === 2;
}

/**
 * Apply the effect of a card that has already been moved to the discard pile.
 * Assumes `idx` is the player who played it.
 */
function applyCardEffect(d: Draft, idx: number, card: Card, events: GameEvent[]): void {
  const player = d.players[idx]!;
  const twoPlayer = activeCount(d) === 2;

  // --- draw cards: grow the stack, then pass the problem along -------------
  if (isDrawCard(card.kind)) {
    if (card.kind === 'wildReverseDrawFour') {
      d.direction = (d.direction * -1) as 1 | -1;
      events.push({ type: 'reversed', direction: d.direction });
    }
    d.pendingDraw += drawValue(card.kind);
    d.stackValue = drawValue(card.kind);
    events.push({ type: 'stackGrew', player: player.id, total: d.pendingDraw });

    if (isWild(card.kind)) {
      d.phase = { type: 'chooseColor', card };
      return;
    }
    // Wild Reverse Draw 4 backfires with two players - see backfires().
    if (backfires(d, card)) {
      d.phase = { type: 'play' };
      events.push({ type: 'turnChanged', player: player.id });
      return;
    }
    advance(d, events);
    return;
  }

  switch (card.kind) {
    case 'number': {
      if (card.rank === 0 && d.rules.zeroPassesHands) {
        passHands(d, events);
        applyMercy(d, events);
      }
      if (card.rank === 7 && d.rules.sevenSwapsHands && activeCount(d) > 1) {
        // Needs a decision from the player before the turn can move on.
        d.phase = { type: 'chooseSwapTarget', card };
        return;
      }
      advance(d, events);
      return;
    }

    case 'skip': {
      const victim = d.players[nextActive(d, d.turn)]!;
      events.push({ type: 'skipped', player: victim.id });
      advance(d, events, 2);
      return;
    }

    case 'reverse': {
      d.direction = (d.direction * -1) as 1 | -1;
      events.push({ type: 'reversed', direction: d.direction });
      // With two players a reverse behaves as a skip, so you play again.
      if (twoPlayer) {
        d.phase = { type: 'play' };
        events.push({ type: 'turnChanged', player: player.id });
        if (endIfOver(d, events)) return;
        return;
      }
      advance(d, events);
      return;
    }

    case 'skipEveryone': {
      events.push({ type: 'everyoneSkipped', by: player.id });
      if (endIfOver(d, events)) return;
      // Everyone else loses their turn; the player goes again.
      d.phase = { type: 'play' };
      events.push({ type: 'turnChanged', player: player.id });
      return;
    }

    case 'discardAll': {
      const color = card.color!;
      const keep = player.hand.filter((c) => c.color !== color);
      const dumped = player.hand.filter((c) => c.color === color);
      if (dumped.length > 0) {
        const top = d.discardPile[d.discardPile.length - 1]!;
        d.discardPile = [...d.discardPile.slice(0, -1), ...dumped, top];
        d.players[idx] = { ...player, hand: keep };
        events.push({ type: 'discardedAll', player: player.id, color, count: dumped.length });
      }
      if (checkFinished(d, idx, events)) {
        endIfOver(d, events);
        return;
      }
      advance(d, events);
      return;
    }

    case 'wildColorRoulette': {
      // The player who plays this does NOT pick a colour - the victim does,
      // and the colour they name is both what they dig for and what ends up
      // in play. Instruction sheet: "The next player chooses a color. After
      // that, they must reveal cards one at a time from the Draw Pile until
      // they get a card of that color."
      const victimIdx = nextActive(d, d.turn);
      d.phase = { type: 'chooseRouletteColor', victim: d.players[victimIdx]!.id };
      return;
    }

    case 'wild': {
      // Not in the standard No Mercy deck, but the deck is config-driven and
      // a custom one may add plain Wilds back.
      d.phase = { type: 'chooseColor', card };
      return;
    }
  }
}

/** Play a card from hand onto the discard pile and run its effect. */
function playCard(d: Draft, idx: number, cardId: string, events: GameEvent[]): void {
  const player = d.players[idx]!;
  const card = player.hand.find((c) => c.id === cardId)!;
  d.players[idx] = { ...player, hand: player.hand.filter((c) => c.id !== cardId) };
  d.discardPile = [...d.discardPile, card];
  d.activeColor = card.color ?? null;
  events.push({ type: 'cardPlayed', player: player.id, card });

  // Emptying your hand wins immediately — before any effect resolves.
  if (d.players[idx]!.hand.length === 0) {
    checkFinished(d, idx, events);
    endIfOver(d, events);
    return;
  }

  applyCardEffect(d, idx, card, events);
}

export function reduce(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (!isLegalAction(state, action)) {
    throw new IllegalActionError(
      `Illegal action ${action.type} by ${action.player} in phase ${state.phase.type}`,
    );
  }

  const d = toDraft(state);
  const events: GameEvent[] = [];
  const idx = d.turn;

  switch (action.type) {
    case 'play':
      playCard(d, idx, action.cardId, events);
      break;

    case 'draw': {
      if (!d.rules.drawUntilPlayable) {
        drawCards(d, idx, 1, events);
      } else {
        // Keep drawing until something is playable. Bounded by the hand limit
        // as well as a hard cap: with an exhausted deck or a pathological
        // rule set this could otherwise never terminate.
        let guard = 0;
        for (;;) {
          const got = drawCards(d, idx, 1, events);
          if (got === 0) break; // deck exhausted
          const player = d.players[idx]!;
          const drawn = player.hand[player.hand.length - 1]!;
          if (canPlay(d as unknown as GameState, drawn)) break;
          if (player.hand.length >= d.rules.handLimit) break;
          if (++guard > 200) break;
        }
      }
      applyMercy(d, events);

      // Force Play: if the card that just arrived is playable, play it rather
      // than letting the player sit on it. Checked AFTER the mercy sweep, so
      // a player eliminated by the draw does not then play a card.
      const drawer = d.players[idx];
      if (d.rules.forcePlay && drawer && isActive(drawer) && drawer.hand.length > 0) {
        const drawn = drawer.hand[drawer.hand.length - 1]!;
        if (canPlay(d as unknown as GameState, drawn)) {
          playCard(d, idx, drawn.id, events);
          break;
        }
      }

      advance(d, events);
      break;
    }

    case 'takeStack': {
      const owed = d.pendingDraw;
      drawCards(d, idx, owed, events);
      events.push({ type: 'stackTaken', player: d.players[idx]!.id, count: owed });
      d.pendingDraw = 0;
      d.stackValue = 0;
      applyMercy(d, events);
      // Taking the stack also costs you your turn.
      advance(d, events);
      break;
    }

    case 'chooseColor': {
      const phase = state.phase as { type: 'chooseColor'; card: Card };
      d.activeColor = action.color;
      events.push({ type: 'colorChosen', player: d.players[idx]!.id, color: action.color });

      // A two-player Wild Reverse Draw 4 leaves the turn where it is, so the
      // colour choice must not hand it over.
      if (backfires(d, phase.card)) {
        d.phase = { type: 'play' };
        events.push({ type: 'turnChanged', player: d.players[idx]!.id });
        break;
      }
      advance(d, events);
      break;
    }

    case 'chooseRouletteColor': {
      const victimIdx = d.players.findIndex((p) => p.id === action.player);
      // The colour the victim names is the one left in play - the Roulette
      // card itself is a wild and carries no colour of its own.
      d.activeColor = action.color;
      events.push({ type: 'rouletteStarted', victim: action.player, color: action.color });
      // Draw until a card of the named colour appears, or the deck runs dry.
      let guard = 0;
      for (;;) {
        const before = d.players[victimIdx]!.hand.length;
        const got = drawCards(d, victimIdx, 1, events);
        if (got === 0) break; // deck exhausted — stop rather than hang
        const drawnCard = d.players[victimIdx]!.hand[before]!;
        if (drawnCard.color === action.color) break;
        if (++guard > 500) break;
      }
      applyMercy(d, events);
      // The victim loses their turn as well.
      advance(d, events, 2);
      break;
    }

    case 'callUno': {
      events.push({ type: 'unoCalled', player: action.player });
      d.unoRisk = null;
      // Saying it is not a move: nobody's turn changes, so return before the
      // usual end-of-action bookkeeping re-opens the window.
      d.seq += 1;
      return { state: d as unknown as GameState, events };
    }

    case 'catchUno': {
      const caught = d.unoRisk!;
      const victimIdx = d.players.findIndex((p) => p.id === caught);
      events.push({ type: 'unoCaught', player: caught, by: action.player });
      drawCards(d, victimIdx, 2, events);
      d.unoRisk = null;
      applyMercy(d, events);
      // Two cards can be the two that end someone's game.
      endIfOver(d, events);
      d.seq += 1;
      return { state: d as unknown as GameState, events };
    }

    case 'chooseSwapTarget': {
      const targetIdx = d.players.findIndex((p) => p.id === action.target);
      const me = d.players[idx]!;
      const them = d.players[targetIdx]!;
      d.players[idx] = { ...me, hand: [...them.hand] };
      d.players[targetIdx] = { ...them, hand: [...me.hand] };
      events.push({ type: 'handsSwapped', a: me.id, b: them.id });
      applyMercy(d, events);
      advance(d, events);
      break;
    }

    case 'declineSwap': {
      events.push({ type: 'swapDeclined', player: d.players[idx]!.id });
      advance(d, events);
      break;
    }
  }

  updateUnoRisk(d, events);
  // Last, so it sees the table exactly as the next player will find it.
  settleIfDeadlocked(d, events);
  d.seq += 1;
  return { state: d as unknown as GameState, events };
}
