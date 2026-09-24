/**
 * Authoritative game room.
 *
 * The room owns the real GameState. Clients send intents; the room validates
 * every one against the engine's legalMoves and broadcasts only redacted
 * views. Nothing a client sends is ever trusted, and nothing a client receives
 * contains another player's hand.
 */

import {
  createGame,
  isLegalAction,
  redactFor,
  reduce,
  ReplayRecorder,
  SPECTATOR,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerSpec,
  type Replay,
} from '@uno/engine';
import { decide, emptyMemory, noteDraw, unoReaction, type BotMemory } from '@uno/bots';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_PLAYERS,
  type ChatMessage,
  type LobbyPlayer,
  type RoomSettings,
  type ServerMessage,
} from '@uno/protocol';

export interface Seat {
  id: string;
  name: string;
  isBot: boolean;
  /** Reconnect credential. Never broadcast to anyone but its owner. */
  token: string;
  connected: boolean;
}

export type Send = (msg: ServerMessage) => void;

/**
 * How long a bot "thinks" before acting, so the table stays readable.
 * Overridable so tests can play a full game without waiting real seconds.
 */
export const BOT_DELAY_MS = Number(process.env.UNO_BOT_DELAY_MS ?? 700);

export function makeCode(rand: () => number): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return out;
}

export class Room {
  readonly seats: Seat[] = [];
  readonly spectators = new Map<string, Send>();
  private readonly sends = new Map<string, Send>();
  private readonly memories: Record<string, BotMemory> = {};
  readonly chat: ChatMessage[] = [];

  state: GameState | null = null;
  private recorder: ReplayRecorder | null = null;
  private rng: number;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private unoTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  started = false;

  constructor(
    readonly code: string,
    public settings: RoomSettings,
    public hostId: string,
    private readonly seed: number,
    /** Injected so tests can run without real timers. */
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly now: () => number = Date.now,
    private botDelayMs: number = BOT_DELAY_MS,
  ) {
    this.rng = seed ^ 0x51ed270b;
  }

  /** Bot pace is a lobby setting, so it can change before the deal. */
  setBotDelay(ms: number): void {
    this.botDelayMs = ms;
  }

  get humanSeats(): Seat[] {
    return this.seats.filter((s) => !s.isBot);
  }

  private lobbyView(): LobbyPlayer[] {
    return this.seats.map((s) => ({
      id: s.id,
      name: s.name,
      isBot: s.isBot,
      isHost: s.id === this.hostId,
      connected: s.connected,
    }));
  }

  attach(id: string, send: Send) {
    this.sends.set(id, send);
    const seat = this.seats.find((s) => s.id === id);
    if (seat) seat.connected = true;
  }

  detach(id: string) {
    this.sends.delete(id);
    this.spectators.delete(id);
    const seat = this.seats.find((s) => s.id === id);
    // Keep the seat so the player can resume; just mark them away.
    if (seat) seat.connected = false;
    this.broadcastLobby();
  }

  addSeat(seat: Seat) {
    this.seats.push(seat);
    this.memories[seat.id] = emptyMemory();
  }

  broadcast(msg: ServerMessage) {
    for (const send of this.sends.values()) send(msg);
    for (const send of this.spectators.values()) send(msg);
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby',
      code: this.code,
      players: this.lobbyView(),
      settings: this.settings,
      hostId: this.hostId,
    });
  }

  /** Send each player their OWN redacted view. This is the anti-cheat seam. */
  broadcastState(events: GameEvent[]) {
    if (!this.state) return;
    for (const [id, send] of this.sends) {
      send({ t: 'state', state: redactFor(this.state, id), events });
    }
    for (const send of this.spectators.values()) {
      send({ t: 'state', state: redactFor(this.state, SPECTATOR), events });
    }
  }

  start(): boolean {
    if (this.started) return false;
    const humans = this.humanSeats;
    if (humans.length === 0) return false;

    // Top the table up with bots to reach the requested size.
    for (let i = 0; i < this.settings.botCount; i++) {
      this.addSeat({
        id: `bot${i}`,
        name: BOT_NAMES[i % BOT_NAMES.length]!,
        isBot: true,
        token: '',
        connected: true,
      });
    }

    const specs: PlayerSpec[] = this.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot }));
    const house = this.settings.rules;
    const created = createGame({
      seed: this.seed,
      players: specs,
      rules: {
        forcePlay: house.forcePlay,
        startingHand: house.startingHand,
        handLimit: house.handLimit,
        stackingEnabled: house.stacking,
        stackMode: house.stackMode,
        sevenSwapsHands: house.sevenSwap,
        zeroPassesHands: house.zeroPass,
        drawUntilPlayable: house.drawUntilPlayable,
        unoCalls: house.unoCalls,
      },
    });
    this.state = created.state;
    this.recorder = new ReplayRecorder(this.seed, specs);
    this.started = true;
    this.broadcastState(created.events);
    this.scheduleBot();
    this.scheduleTurnTimeout();
    return true;
  }

  /** Whose decision is pending (Color Roulette targets the victim, not the seat). */
  actorId(): string | null {
    const s = this.state;
    if (!s || s.phase.type === 'gameOver') return null;
    if (s.phase.type === 'chooseRouletteColor') return s.phase.victim;
    return s.players[s.turn]?.id ?? null;
  }

  /** Apply a player's intent. Returns an error code, or null on success. */
  submit(playerId: string, action: Action): 'illegal_action' | null {
    const s = this.state;
    if (!s) return 'illegal_action';
    // Two gates: the action must belong to this player, AND be legal. Without
    // the first, a client could submit a valid-looking action on someone
    // else's behalf.
    if (action.player !== playerId) return 'illegal_action';
    // Calling UNO is the one action taken off-turn, so it skips the "is it
    // your go" gate. isLegalAction still decides whether it is allowed at all.
    const offTurn = action.type === 'callUno' || action.type === 'catchUno';
    if (!offTurn && this.actorId() !== playerId) return 'illegal_action';
    if (!isLegalAction(s, action)) return 'illegal_action';
    this.applyAction(action);
    return null;
  }

  private applyAction(action: Action) {
    const s = this.state;
    if (!s) return;
    if (action.type === 'draw' || action.type === 'takeStack') {
      this.memories[action.player] = noteDraw(
        this.memories[action.player] ?? emptyMemory(),
        action.player,
        s.activeColor,
      );
    }
    this.recorder?.record(action);
    const r = reduce(s, action);
    this.state = r.state;
    this.broadcastState(r.events);

    if (this.state.phase.type === 'gameOver') {
      this.clearBotTimer();
      this.clearTurnTimer();
      this.broadcast({ t: 'ended', winner: this.state.phase.winner });
      return;
    }
    this.scheduleBot();
    this.scheduleUno();
    this.scheduleTurnTimeout();
  }

  private clearUnoTimer() {
    if (this.unoTimer) {
      clearTimeout(this.unoTimer);
      this.unoTimer = null;
    }
  }

  /**
   * Let bots react to a hanging UNO, on their own clock.
   *
   * Independent of the turn timer because this happens off-turn. Humans get a
   * longer fuse than bots do: the printed window is "before the next player
   * begins their turn", which over a network is no window at all.
   */
  private scheduleUno() {
    this.clearUnoTimer();
    const s = this.state;
    if (!s || s.phase.type === 'gameOver' || s.unoRisk === null) return;
    const atRisk = this.seats.find((seat) => seat.id === s.unoRisk);
    const delay = atRisk?.isBot ? UNO_SELF_MS : UNO_GRACE_MS;

    this.unoTimer = this.schedule(() => {
      this.unoTimer = null;
      const cur = this.state;
      if (!cur || cur.phase.type === 'gameOver' || cur.unoRisk === null) return;
      for (const seat of this.seats) {
        if (!seat.isBot) continue;
        const r = unoReaction(this.settings.difficulty, redactFor(cur, seat.id), this.rng);
        this.rng = r.rng;
        if (r.action) return this.applyAction(r.action);
      }
    }, delay);
  }

  private clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /**
   * Auto-act for a human who has run out of time.
   *
   * Uses the SAME bot brain the AI seats use, so the fallback move is a legal,
   * sensible one rather than a forfeit. A player who steps away loses tempo,
   * not the game.
   */
  private scheduleTurnTimeout() {
    this.clearTurnTimer();
    const limit = this.settings.turnSeconds;
    if (!limit) return;

    const actor = this.actorId();
    if (!actor) return;
    const seat = this.seats.find((s) => s.id === actor);
    // Bots have their own timer; only humans can stall.
    if (!seat || seat.isBot) return;

    this.turnTimer = this.schedule(() => {
      this.turnTimer = null;
      const s = this.state;
      if (!s || s.phase.type === 'gameOver') return;
      if (this.actorId() !== actor) return;
      const view = redactFor(s, actor);
      const d = decide(this.settings.difficulty, view, this.rng, this.memories[actor]!);
      this.rng = d.rng;
      this.broadcast({
        t: 'chat',
        message: {
          from: 'server',
          name: 'table',
          text: `${seat.name} ran out of time`,
          at: this.now(),
        },
      });
      this.applyAction(d.action);
    }, limit * 1000);
  }

  private clearBotTimer() {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  /** If a bot is up, act after a short delay so humans can follow along. */
  private scheduleBot() {
    this.clearBotTimer();
    const actor = this.actorId();
    if (!actor) return;
    const seat = this.seats.find((s) => s.id === actor);
    if (!seat?.isBot || !this.state) return;

    this.botTimer = this.schedule(() => {
      this.botTimer = null;
      const s = this.state;
      if (!s || s.phase.type === 'gameOver') return;
      const view = redactFor(s, actor);
      const d = decide(this.settings.difficulty, view, this.rng, this.memories[actor]!);
      this.rng = d.rng;
      this.applyAction(d.action);
    }, this.botDelayMs);
  }

  postChat(from: string, name: string, text: string) {
    const message: ChatMessage = { from, name, text, at: this.now() };
    this.chat.push(message);
    if (this.chat.length > 100) this.chat.shift();
    this.broadcast({ t: 'chat', message });
  }

  replay(): Replay | null {
    if (!this.recorder || !this.state) return null;
    const winner = this.state.phase.type === 'gameOver' ? this.state.phase.winner : null;
    return this.recorder.finish(winner);
  }

  get empty(): boolean {
    return this.humanSeats.every((s) => !s.connected) && this.spectators.size === 0;
  }

  dispose() {
    this.clearBotTimer();
    this.clearUnoTimer();
    this.clearTurnTimer();
  }
}

/** Matches the solo game: a real race for a human, a quick beat for a bot. */
const UNO_GRACE_MS = 2000;
const UNO_SELF_MS = 550;

const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Knuth', 'Lovelace', 'Dijkstra', 'Ritchie', 'Karp', 'Liskov'];

export { MAX_PLAYERS };
