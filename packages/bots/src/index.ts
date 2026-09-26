/**
 * Bot opponents — easy, medium, hard.
 *
 * Every bot decides from RedactedState only. They cannot see other hands, the
 * draw pile, or the RNG, so a bot has exactly the information a human at the
 * table has. A bot that peeks isn't a difficulty level, it's a bug.
 *
 * Bots are also deterministic: randomness comes from a seed passed in, never
 * Math.random(), so a simulation failure reproduces exactly.
 */

import {
  COLORS,
  canPlayView,
  drawValue,
  isDrawCard,
  isWild,
  nextInt,
  ownHand,
  playableFor,
  viewOfRedacted,
  type Action,
  type Card,
  type Color,
  type RedactedState,
} from '@mercy/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotMemory {
  /**
   * Colours a player is believed NOT to hold, inferred from them drawing or
   * taking a stack when that colour was active. Only the hard bot uses this.
   */
  voids: Record<string, Partial<Record<Color, boolean>>>;
}

export function emptyMemory(): BotMemory {
  return { voids: {} };
}

/** Rough "how much damage does this card do" score, used for discard priority. */
function aggression(card: Card): number {
  if (isDrawCard(card.kind)) return 10 + drawValue(card.kind);
  if (card.kind === 'skipEveryone') return 9;
  if (card.kind === 'wildColorRoulette') return 12;
  if (card.kind === 'skip') return 6;
  if (card.kind === 'reverse') return 4;
  if (card.kind === 'discardAll') return 8;
  return card.rank ?? 0;
}

function countByColor(hand: readonly Card[]): Record<Color, number> {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 } as Record<Color, number>;
  for (const c of hand) if (c.color) counts[c.color]++;
  return counts;
}

function bestColor(hand: readonly Card[], rng: number): { color: Color; rng: number } {
  const counts = countByColor(hand);
  let best: Color = 'red';
  let bestN = -1;
  for (const c of COLORS) {
    if (counts[c] > bestN) {
      bestN = counts[c];
      best = c;
    }
  }
  // No coloured cards at all — pick randomly rather than always 'red',
  // otherwise the bot is trivially readable.
  if (bestN <= 0) {
    const r = nextInt(rng, COLORS.length);
    return { color: COLORS[r.value]!, rng: r.state };
  }
  return { color: best, rng };
}

/** Active opponents sorted by hand size, smallest (most dangerous) first. */
function threats(state: RedactedState) {
  return state.players
    .filter((p) => p.id !== state.viewer && !p.eliminated && !p.finished)
    .sort((a, b) => a.handCount - b.handCount);
}

export interface Decision {
  action: Action;
  rng: number;
}

export function decide(
  difficulty: Difficulty,
  state: RedactedState,
  rng: number,
  memory: BotMemory = emptyMemory(),
): Decision {
  const me = state.viewer;

  // --- decision phases that aren't "which card do I play" -----------------
  switch (state.phase.type) {
    case 'chooseColor': {
      const hand = ownHand(state);
      if (difficulty === 'easy') {
        const r = nextInt(rng, COLORS.length);
        return { action: { type: 'chooseColor', player: me, color: COLORS[r.value]! }, rng: r.state };
      }
      const { color, rng: r2 } = bestColor(hand, rng);
      return { action: { type: 'chooseColor', player: me, color }, rng: r2 };
    }

    case 'chooseRouletteColor': {
      const hand = ownHand(state);
      if (difficulty === 'easy') {
        const r = nextInt(rng, COLORS.length);
        return {
          action: { type: 'chooseRouletteColor', player: me, color: COLORS[r.value]! },
          rng: r.state,
        };
      }
      // You draw UNTIL you hit this colour, so name the one you'd most like
      // to receive — which is also the one most likely to come up soon.
      const { color, rng: r2 } = bestColor(hand, rng);
      return { action: { type: 'chooseRouletteColor', player: me, color }, rng: r2 };
    }

    case 'chooseSwapTarget': {
      const opponents = threats(state);
      if (difficulty === 'easy') {
        const r = nextInt(rng, opponents.length);
        return {
          action: { type: 'chooseSwapTarget', player: me, target: opponents[r.value]!.id },
          rng: r.state,
        };
      }
      // Take the smallest hand on the table — that both helps you and hurts
      // whoever was closest to winning.
      return { action: { type: 'chooseSwapTarget', player: me, target: opponents[0]!.id }, rng };
    }

    case 'gameOver':
      throw new Error('decide() called on a finished game');

    case 'play':
      break;
  }

  // --- normal turn --------------------------------------------------------
  const playable = playableFor(state);

  const fallback = (): Action =>
    state.pendingDraw > 0 ? { type: 'takeStack', player: me } : { type: 'draw', player: me };

  if (playable.length === 0) return { action: fallback(), rng };

  if (difficulty === 'easy') {
    const r = nextInt(rng, playable.length);
    return { action: { type: 'play', player: me, cardId: playable[r.value]!.id }, rng: r.state };
  }

  const hand = ownHand(state);
  const counts = countByColor(hand);

  // Under attack: continuing the stack is almost always better than eating it,
  // and the cheapest card that does the job preserves the big ones.
  if (state.pendingDraw > 0) {
    const cheapest = [...playable].sort((a, b) => drawValue(a.kind) - drawValue(b.kind))[0]!;
    return { action: { type: 'play', player: me, cardId: cheapest.id }, rng };
  }

  if (difficulty === 'medium') {
    /**
     * No Mercy has no points scoring, so the classic "shed your high cards"
     * heuristic is worse than useless here: it burns the draw cards that are
     * your only defence against an incoming stack, and eating a +10 puts you
     * 10 cards closer to the 25-card elimination.
     *
     * Medium therefore plays its cheap, replaceable cards and keeps its
     * defensive ones: draw cards and wilds are held back for when they matter.
     */
    const scored = [...playable]
      .map((card) => {
        let score = 0;

        // Plain numbers are the cards with no future value — spend them first.
        if (card.kind === 'number') score += 10;

        // Staying in your majority colour keeps your next turn open.
        if (card.color) score += counts[card.color] * 3;

        // Tempo cards are fine to play: they have no defensive use.
        if (card.kind === 'skip' || card.kind === 'reverse') score += 6;
        if (card.kind === 'skipEveryone') score += 8;

        // Discard All can dump a whole colour at once — take it when it's fat.
        if (card.kind === 'discardAll' && card.color) score += counts[card.color] * 5;

        // Hold draw cards in reserve; they are the answer to being attacked.
        if (isDrawCard(card.kind)) score -= 15 + drawValue(card.kind);

        // Wilds are always playable, which makes them the best card to still
        // be holding when nothing else matches.
        if (isWild(card.kind)) score -= 30;

        return { card, score };
      })
      .sort((a, b) => b.score - a.score);

    return { action: { type: 'play', player: me, cardId: scored[0]!.card.id }, rng };
  }

  // --- hard ---------------------------------------------------------------
  const opponents = threats(state);
  const leader = opponents[0];
  // Someone is about to go out, so maximise damage instead of playing tidy.
  const underPressure = !!leader && leader.handCount <= 2;
  const view = viewOfRedacted(state);

  const scored = [...playable]
    .map((card) => {
      let score = 0;

      if (underPressure) {
        // Hit them with everything.
        score += aggression(card) * 3;
        if (card.kind === 'wildColorRoulette') score += 25;
        if (card.kind === 'number' && card.rank === 7) score += 20; // steal the small hand
      } else {
        // Same reasoning as medium: with no points scoring, draw cards are
        // defence, not currency. Spend the cards with no future value first.
        if (card.kind === 'number') score += 10;
        if (card.kind === 'skip' || card.kind === 'reverse') score += 6;
        if (card.kind === 'skipEveryone') score += 9;
        // Hold the stack answers back until someone actually attacks.
        if (isDrawCard(card.kind)) score -= 15 + drawValue(card.kind);
        // Keep wilds: they are the only cards that are always playable.
        if (isWild(card.kind)) score -= 40;
        // Steering toward your own majority colour keeps future turns open.
        if (card.color) score += counts[card.color] * 2;
      }

      // A 0 passes hands around; only good when your hand is big.
      if (card.kind === 'number' && card.rank === 0) {
        const mine = hand.length;
        const smallest = leader?.handCount ?? mine;
        score += mine > smallest ? 15 : -10;
      }

      // Discard All is worth the most when you are heavy in that colour.
      if (card.kind === 'discardAll' && card.color) score += counts[card.color] * 6;

      // Playing into a colour an opponent is known to be void in is good.
      if (card.color && leader && memory.voids[leader.id]?.[card.color]) score += 12;

      // Don't strand yourself: prefer a card that leaves you another option.
      const rest = hand.filter((c) => c.id !== card.id);
      const followUps = rest.filter((c) =>
        canPlayView({ ...view, activeColor: card.color ?? view.activeColor, discardTop: card }, c),
      ).length;
      score += Math.min(followUps, 3) * 2;

      return { card, score };
    })
    .sort((a, b) => b.score - a.score);

  return { action: { type: 'play', player: me, cardId: scored[0]!.card.id }, rng };
}

/**
 * Update inferred voids. Call whenever a player draws or takes a stack while a
 * colour was active — it is weak evidence they hold nothing in that colour.
 */
export function noteDraw(memory: BotMemory, player: string, activeColor: Color | null): BotMemory {
  if (!activeColor) return memory;
  const voids = { ...memory.voids, [player]: { ...memory.voids[player], [activeColor]: true } };
  return { voids };
}

/** They played that colour, so they clearly aren't void in it. */
export function noteplayed(memory: BotMemory, player: string, color: Color | undefined): BotMemory {
  if (!color || !memory.voids[player]) return memory;
  const entry = { ...memory.voids[player] };
  delete entry[color];
  return { voids: { ...memory.voids, [player]: entry } };
}

/**
 * Whether this bot says "UNO!" right now — about itself, or about someone else.
 *
 * Kept apart from decide() because it is the one thing a player may do when it
 * is not their turn, so the game loop has to ask after EVERY state change
 * rather than only on this bot's move.
 *
 * A bot never forgets to call its own. Catching someone else is where the
 * difficulty shows: an easy bot mostly misses it, a hard bot never does.
 * The delay before this gets asked — the human's chance to get there first —
 * belongs to the caller, not here.
 */
const CATCH_CHANCE: Record<Difficulty, number> = { easy: 0.25, medium: 0.65, hard: 1 };

/**
 * A decision that may be "say nothing". The rng still advances when a bot
 * rolls and decides to stay quiet, so replays stay exact either way.
 */
export interface Reaction {
  action: Action | null;
  rng: number;
}

export function unoReaction(
  difficulty: Difficulty,
  state: RedactedState,
  rng: number,
): Reaction {
  const me = state.viewer;
  if (!state.rules.unoCalls || state.unoRisk === null) return { action: null, rng };

  const self = state.players.find((p) => p.id === me);
  if (!self || self.eliminated || self.finished) return { action: null, rng };

  if (state.unoRisk === me) return { action: { type: 'callUno', player: me }, rng };

  const r = nextInt(rng, 1000);
  if (r.value >= CATCH_CHANCE[difficulty] * 1000) return { action: null, rng: r.state };
  return { action: { type: 'catchUno', player: me }, rng: r.state };
}
