/**
 * Replays.
 *
 * Because the engine is deterministic, a replay does NOT need to store game
 * states or even the event log — the seed plus the list of actions reproduces
 * the game exactly. A full game is a couple of KB, and stepping through it is
 * just replaying prefixes of the action list.
 *
 * This is also the debugging tool: a replay file from a real game re-runs
 * identically here, so "it did something weird on turn 40" is reproducible.
 */

import type { GameEvent } from './events.js';
import type { Action } from './legal.js';
import { reduce } from './reduce.js';
import { createGame, type PlayerSpec } from './setup.js';
import type { GameState, RuleConfig } from './types.js';

export const REPLAY_VERSION = 1;

export interface Replay {
  version: number;
  seed: number;
  players: PlayerSpec[];
  rules?: Partial<RuleConfig>;
  actions: Action[];
  /** Informational only; the replay is authoritative via re-simulation. */
  winner?: string | null;
}

export interface ReplayFrame {
  state: GameState;
  events: GameEvent[];
  /** Index of the action that produced this frame; -1 for the initial deal. */
  actionIndex: number;
}

/** Re-run a replay and return every intermediate frame, for step-through playback. */
export function playback(replay: Replay): ReplayFrame[] {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(`Unsupported replay version ${replay.version} (expected ${REPLAY_VERSION})`);
  }
  const created = createGame({
    seed: replay.seed,
    players: replay.players,
    ...(replay.rules ? { rules: replay.rules } : {}),
  });

  const frames: ReplayFrame[] = [
    { state: created.state, events: created.events, actionIndex: -1 },
  ];
  let state = created.state;
  for (let i = 0; i < replay.actions.length; i++) {
    const r = reduce(state, replay.actions[i]!);
    state = r.state;
    frames.push({ state, events: r.events, actionIndex: i });
  }
  return frames;
}

/** Re-run a replay and return only the final state. */
export function finalState(replay: Replay): GameState {
  const frames = playback(replay);
  return frames[frames.length - 1]!.state;
}

/** Records actions as a game is played, producing a Replay at the end. */
export class ReplayRecorder {
  private readonly actions: Action[] = [];

  constructor(
    private readonly seed: number,
    private readonly players: PlayerSpec[],
    private readonly rules?: Partial<RuleConfig>,
  ) {}

  record(action: Action): void {
    this.actions.push(action);
  }

  finish(winner: string | null): Replay {
    return {
      version: REPLAY_VERSION,
      seed: this.seed,
      players: this.players,
      ...(this.rules ? { rules: this.rules } : {}),
      actions: [...this.actions],
      winner,
    };
  }
}
