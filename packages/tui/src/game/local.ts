/**
 * Local game controller: one human against bots.
 *
 * Deliberately free of OpenTUI/React imports so the whole game loop can be
 * unit-tested headlessly and reused by the network client later.
 *
 * The controller owns the authoritative GameState and hands out only redacted
 * views — the same discipline the server uses, so the UI is already written
 * against the shape it will get over the wire.
 */

import {
  createGame,
  redactFor,
  reduce,
  ReplayRecorder,
  type Action,
  type GameEvent,
  type PlayerSpec,
  type RedactedState,
  type Replay,
  type RuleConfig,
} from '@uno/engine';
import { decide, emptyMemory, noteDraw, type BotMemory, type Difficulty } from '@uno/bots';
import { describeEvent, type LogEntry } from './narrate.js';

export type { LogEntry };

export interface LocalGameOptions {
  seed: number;
  humanName: string;
  botCount: number;
  difficulty: Difficulty;
  rules?: Partial<RuleConfig>;
}

export const HUMAN_ID = 'you';

export class LocalGame {
  private state;
  private readonly recorder;
  private readonly memories: Record<string, BotMemory> = {};
  private readonly difficulty: Difficulty;
  private rng: number;
  private listeners = new Set<() => void>();

  readonly log: LogEntry[] = [];
  /** The viewer's player id. Constant for a local game. */
  readonly youId = HUMAN_ID;
  readonly spectator = false;
  /** Cards played most recently, newest first — drives the play animation. */
  lastEvents: GameEvent[] = [];

  constructor(opts: LocalGameOptions) {
    const specs: PlayerSpec[] = [
      { id: HUMAN_ID, name: opts.humanName, isBot: false },
      ...Array.from({ length: opts.botCount }, (_, i) => ({
        id: `bot${i}`,
        name: BOT_NAMES[i % BOT_NAMES.length]!,
        isBot: true,
      })),
    ];

    const created = createGame({
      seed: opts.seed,
      players: specs,
      ...(opts.rules ? { rules: opts.rules } : {}),
    });
    this.state = created.state;
    this.recorder = new ReplayRecorder(opts.seed, specs, opts.rules);
    this.difficulty = opts.difficulty;
    this.rng = opts.seed ^ 0x9e3779b9;
    for (const p of specs) this.memories[p.id] = emptyMemory();
    this.pushEvents(created.events);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** The human's view. Never exposes bot hands — same guarantee as the server. */
  view(): RedactedState {
    return redactFor(this.state, HUMAN_ID);
  }

  get raw() {
    return this.state;
  }

  get isOver(): boolean {
    return this.state.phase.type === 'gameOver';
  }

  get winner(): string | null {
    return this.state.phase.type === 'gameOver' ? this.state.phase.winner : null;
  }

  /** Whose decision is pending — accounts for Color Roulette targeting the victim. */
  actorId(): string {
    if (this.state.phase.type === 'chooseRouletteColor') return this.state.phase.victim;
    return this.state.players[this.state.turn]?.id ?? '';
  }

  waitingOnHuman(): boolean {
    return !this.isOver && this.actorId() === HUMAN_ID;
  }

  apply(action: Action): boolean {
    try {
      this.recorder.record(action);
      const r = reduce(this.state, action);
      this.state = r.state;
      this.pushEvents(r.events);
      this.emit();
      return true;
    } catch {
      // Illegal move: the UI only offers legal ones, so this means a bug or a
      // stale keypress. Swallow it rather than crashing mid-game.
      return false;
    }
  }

  /** Advance one bot decision. Returns false when it is the human's turn. */
  stepBot(): boolean {
    if (this.isOver || this.waitingOnHuman()) return false;
    const actor = this.actorId();
    const view = redactFor(this.state, actor);
    const decision = decide(this.difficulty, view, this.rng, this.memories[actor]!);
    this.rng = decision.rng;
    if (decision.action.type === 'draw' || decision.action.type === 'takeStack') {
      this.memories[actor] = noteDraw(this.memories[actor]!, actor, this.state.activeColor);
    }
    return this.apply(decision.action);
  }

  finishReplay(): Replay {
    return this.recorder.finish(this.winner);
  }

  private name(id: string): string {
    return this.state.players.find((p) => p.id === id)?.name ?? id;
  }

  private pushEvents(events: GameEvent[]) {
    this.lastEvents = events;
    for (const e of events) {
      const line = describeEvent(e, (id) => this.name(id));
      if (line) this.log.push(line);
    }
    // Keep the log bounded; the replay has the full history if it's ever needed.
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }
}

const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Knuth', 'Lovelace', 'Dijkstra', 'Ritchie', 'Karp', 'Liskov'];
