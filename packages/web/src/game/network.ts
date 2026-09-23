/**
 * Network game client.
 *
 * Deliberately mirrors LocalGame's shape (view(), subscribe(), apply(),
 * isOver, winner) so the Table screen renders a LAN game and a bot game with
 * the same code and no branching.
 *
 * The client is a thin renderer: it holds only the redacted state the server
 * sends, and sends intents back. It never computes authority.
 */

import type { Action, GameEvent, RedactedState } from '@uno/engine';
import {
  PROTOCOL_VERSION,
  type ChatMessage,
  type ClientMessage,
  type LobbyPlayer,
  type RoomSettings,
  type ServerMessage,
} from '@uno/protocol';
import type { LogEntry } from './local.js';
import { describeEvent } from './narrate.js';

export type ConnectionStatus = 'connecting' | 'lobby' | 'playing' | 'ended' | 'error' | 'closed';

export interface NetworkGameOptions {
  url: string;
  name: string;
  /** Create a new room, join an existing one, or watch. */
  mode: { kind: 'create'; settings: RoomSettings } | { kind: 'join'; code: string } | { kind: 'spectate'; code: string };
}

export class NetworkGame {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private state: RedactedState | null = null;
  private reconnectToken: string | null = null;
  private closedByUs = false;

  status: ConnectionStatus = 'connecting';
  error: string | null = null;
  code = '';
  youId = '';
  isHost = false;
  spectator = false;
  lobby: LobbyPlayer[] = [];
  settings: RoomSettings | null = null;
  chat: ChatMessage[] = [];
  readonly log: LogEntry[] = [];
  winner: string | null = null;
  lastEvents: GameEvent[] = [];

  constructor(private readonly opts: NetworkGameOptions) {
    this.connect();
  }

  private connect() {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      this.status = 'error';
      this.error = `Could not open ${this.opts.url}: ${String(e)}`;
      this.emit();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      const { mode, name } = this.opts;
      // Prefer resuming a seat we already hold over taking a new one.
      if (this.reconnectToken) {
        this.send({ t: 'resume', code: this.code, token: this.reconnectToken, version: PROTOCOL_VERSION });
      } else if (mode.kind === 'create') {
        this.send({ t: 'create', name, settings: mode.settings, version: PROTOCOL_VERSION });
      } else if (mode.kind === 'join') {
        this.send({ t: 'join', code: mode.code.toUpperCase(), name, version: PROTOCOL_VERSION });
      } else {
        this.send({ t: 'spectate', code: mode.code.toUpperCase(), name, version: PROTOCOL_VERSION });
      }
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(msg);
    };

    ws.onerror = () => {
      if (this.closedByUs) return;
      this.status = 'error';
      this.error = this.error ?? `Cannot reach ${this.opts.url}. Is the server running?`;
      this.emit();
    };

    ws.onclose = () => {
      if (this.closedByUs) return;
      if (this.status !== 'error' && this.status !== 'ended') {
        this.status = 'closed';
        this.error = 'Connection lost.';
      }
      this.emit();
    };
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        this.code = msg.code;
        this.youId = msg.you;
        this.isHost = msg.isHost;
        this.spectator = msg.spectator;
        if (msg.token) this.reconnectToken = msg.token;
        this.status = 'lobby';
        break;
      case 'lobby':
        this.lobby = msg.players;
        this.settings = msg.settings;
        this.isHost = msg.hostId === this.youId;
        break;
      case 'state':
        this.state = msg.state;
        this.status = msg.state.phase.type === 'gameOver' ? 'ended' : 'playing';
        this.lastEvents = msg.events;
        this.narrate(msg.events);
        break;
      case 'chat':
        this.chat.push(msg.message);
        if (this.chat.length > 100) this.chat.shift();
        break;
      case 'ended':
        this.winner = msg.winner;
        this.status = 'ended';
        break;
      case 'error':
        this.error = msg.message;
        // A failed join is fatal; an illegal move is not.
        if (msg.code !== 'illegal_action' && msg.code !== 'rate_limited') this.status = 'error';
        break;
    }
    this.emit();
  }

  private narrate(events: GameEvent[]) {
    const name = (id: string) => this.lobby.find((p) => p.id === id)?.name ?? this.nameFromState(id);
    for (const e of events) {
      const entry = describeEvent(e, name);
      if (entry) this.log.push(entry);
    }
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  private nameFromState(id: string): string {
    return this.state?.players.find((p) => p.id === id)?.name ?? id;
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // --- the LocalGame-shaped surface the Table renders against --------------

  view(): RedactedState | null {
    return this.state;
  }

  get isOver(): boolean {
    return this.status === 'ended';
  }

  waitingOnHuman(): boolean {
    const s = this.state;
    if (!s || this.spectator || this.isOver) return false;
    const actor = s.phase.type === 'chooseRouletteColor' ? s.phase.victim : s.players[s.turn]?.id;
    return actor === this.youId;
  }

  apply(action: Action): boolean {
    if (this.spectator) return false;
    this.send({ t: 'action', action });
    return true;
  }

  // --- lobby controls ------------------------------------------------------

  start() {
    this.send({ t: 'start' });
  }

  updateSettings(settings: Partial<RoomSettings>) {
    this.send({ t: 'settings', settings });
  }

  say(text: string) {
    if (text.trim()) this.send({ t: 'chat', text });
  }

  leave() {
    this.closedByUs = true;
    this.send({ t: 'leave' });
    this.ws?.close();
    this.status = 'closed';
    this.emit();
  }
}
