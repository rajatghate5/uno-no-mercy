/**
 * Headless simulation harness.
 *
 * Plays full bot-vs-bot games and asserts invariants after EVERY action. This
 * is the thing that actually finds engine bugs — unit tests check the rules you
 * thought of, the harness checks the ones you didn't.
 *
 * Every run is seeded, so a failure reproduces exactly: paste the seed into a
 * test and debug it deterministically.
 */

import {
  createGame,
  redactFor,
  reduce,
  ReplayRecorder,
  type Action,
  type GameEvent,
  type GameState,
  type Replay,
} from '@uno/engine';
import { decide, emptyMemory, noteDraw, type BotMemory, type Difficulty } from '@uno/bots';

export class InvariantError extends Error {
  constructor(
    message: string,
    readonly seed: number,
    readonly turn: number,
  ) {
    super(`[seed ${seed}, turn ${turn}] ${message}`);
  }
}

/**
 * Total cards must be conserved at all times. This single check catches almost
 * every dealing, stacking, hand-swap, discard-all and elimination bug, because
 * all of them move cards between collections.
 */
export function totalCards(state: GameState): number {
  return (
    state.players.reduce((n, p) => n + p.hand.length, 0) +
    state.drawPile.length +
    state.discardPile.length
  );
}

export function checkInvariants(state: GameState, seed: number, turn: number, expectedTotal: number) {
  const total = totalCards(state);
  if (total !== expectedTotal) {
    throw new InvariantError(`card conservation broken: ${total} != ${expectedTotal}`, seed, turn);
  }

  for (const p of state.players) {
    if (p.hand.length > state.rules.handLimit && !p.eliminated) {
      throw new InvariantError(
        `${p.id} holds ${p.hand.length} cards but was not eliminated (limit ${state.rules.handLimit})`,
        seed,
        turn,
      );
    }
    if (p.finished && p.hand.length > 0) {
      throw new InvariantError(`${p.id} finished but still holds ${p.hand.length} cards`, seed, turn);
    }
  }

  if (state.pendingDraw < 0 || state.stackValue < 0) {
    throw new InvariantError(`negative stack: pending=${state.pendingDraw}`, seed, turn);
  }

  if (state.phase.type !== 'gameOver') {
    const current = state.players[state.turn];
    if (!current) throw new InvariantError(`turn index ${state.turn} out of range`, seed, turn);
    if (current.eliminated || current.finished) {
      throw new InvariantError(`turn is on inactive player ${current.id}`, seed, turn);
    }
  }
}

export interface SimResult {
  seed: number;
  turns: number;
  winner: string | null;
  events: GameEvent[];
  finalState: GameState;
  eliminations: number;
  replay: Replay;
}

export function simulate(opts: {
  seed: number;
  playerCount?: number;
  difficulties?: Difficulty[];
  maxTurns?: number;
  collectEvents?: boolean;
}): SimResult {
  const playerCount = opts.playerCount ?? 4;
  const difficulties: Difficulty[] =
    opts.difficulties ?? Array.from({ length: playerCount }, () => 'medium' as const);

  const specs = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `Bot ${i}`,
    isBot: true,
  }));
  const created = createGame({ seed: opts.seed, players: specs });
  const recorder = new ReplayRecorder(opts.seed, specs);

  let state = created.state;
  const events: GameEvent[] = opts.collectEvents ? [...created.events] : [];
  const expectedTotal = totalCards(state);
  const memories: Record<string, BotMemory> = {};
  for (const p of state.players) memories[p.id] = emptyMemory();

  let rng = state.rng ^ 0x5f3759df;
  const maxTurns = opts.maxTurns ?? state.rules.maxTurns;
  let turn = 0;

  checkInvariants(state, opts.seed, turn, expectedTotal);

  while (state.phase.type !== 'gameOver') {
    if (++turn > maxTurns) {
      throw new InvariantError(`game did not terminate within ${maxTurns} turns`, opts.seed, turn);
    }

    // Whose decision is it? Usually the seated player, except for Color
    // Roulette where the VICTIM names the colour.
    const actorId =
      state.phase.type === 'chooseRouletteColor'
        ? state.phase.victim
        : state.players[state.turn]!.id;
    const actorIdx = state.players.findIndex((p) => p.id === actorId);
    const difficulty = difficulties[actorIdx % difficulties.length]!;

    // Bots see only redacted state — same information a human would have.
    const view = redactFor(state, actorId);
    const decision = decide(difficulty, view, rng, memories[actorId]!);
    rng = decision.rng;

    const action: Action = decision.action;
    if (action.type === 'draw' || action.type === 'takeStack') {
      memories[actorId] = noteDraw(memories[actorId]!, actorId, state.activeColor);
    }

    recorder.record(action);
    const result = reduce(state, action);
    state = result.state;
    if (opts.collectEvents) events.push(...result.events);

    checkInvariants(state, opts.seed, turn, expectedTotal);
  }

  const winner = state.phase.type === 'gameOver' ? state.phase.winner : null;
  return {
    seed: opts.seed,
    turns: turn,
    winner,
    events,
    finalState: state,
    eliminations: state.players.filter((p) => p.eliminated).length,
    replay: recorder.finish(winner),
  };
}
