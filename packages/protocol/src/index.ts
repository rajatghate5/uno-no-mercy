/**
 * Wire protocol, shared by server and client.
 *
 * Design rule: the client sends INTENT, never state. The server owns the
 * GameState and broadcasts redacted views. A modified client can therefore
 * ask for something illegal, but it cannot make it happen, and it cannot see
 * another player's hand because that data never crosses the wire.
 */

import type { Action, Color, GameEvent, RedactedState } from '@uno/engine';
import type { Difficulty } from '@uno/bots';

export const PROTOCOL_VERSION = 1;

/** Room codes are short, unambiguous, and safe to read aloud over a call. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
export const CODE_LENGTH = 4;

export interface RoomSettings {
  botCount: number;
  difficulty: Difficulty;
  maxPlayers: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface ChatMessage {
  from: string;
  name: string;
  text: string;
  /** Server-stamped; clients must not be trusted with their own clock. */
  at: number;
}

// --- client -> server -------------------------------------------------------

export type ClientMessage =
  | { t: 'create'; name: string; settings: RoomSettings; version: number }
  | { t: 'join'; code: string; name: string; version: number }
  | { t: 'spectate'; code: string; name: string; version: number }
  /** Reclaim a seat after a dropped connection. */
  | { t: 'resume'; code: string; token: string; version: number }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'leave' };

// --- server -> client -------------------------------------------------------

export type ServerMessage =
  /** Sent once on join; `token` is the reconnect credential. */
  | { t: 'welcome'; code: string; you: string; token: string; isHost: boolean; spectator: boolean }
  | { t: 'lobby'; code: string; players: LobbyPlayer[]; settings: RoomSettings; hostId: string }
  | { t: 'state'; state: RedactedState; events: GameEvent[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'ended'; winner: string | null };

export type ErrorCode =
  | 'no_such_room'
  | 'room_full'
  | 'name_taken'
  | 'already_started'
  | 'not_host'
  | 'bad_version'
  | 'illegal_action'
  | 'bad_message'
  | 'rate_limited';

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;
export const MAX_PLAYERS = 10;

/**
 * Strip ASCII control characters and DEL.
 *
 * Names and chat arrive from strangers on the network and get printed straight
 * into a terminal. An unescaped ESC inside a name would let anyone emit ANSI
 * sequences and scribble anywhere on your screen, so this is a security
 * boundary, not cosmetics. Built with new RegExp so the source file itself
 * contains no literal control bytes.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.replace(CONTROL_CHARS, '').trim().slice(0, MAX_NAME_LENGTH) || 'player';
}

export function cleanChat(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.replace(CONTROL_CHARS, '').trim().slice(0, MAX_CHAT_LENGTH);
}

export function isColor(v: unknown): v is Color {
  return v === 'red' || v === 'yellow' || v === 'green' || v === 'blue';
}

/** Parse an untrusted wire payload. Returns null instead of throwing. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const t = (data as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  // Shape is validated properly by the server against the room's phase;
  // this is the cheap structural gate.
  return data as ClientMessage;
}
