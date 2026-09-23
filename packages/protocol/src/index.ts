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

/**
 * House rules a host can change before dealing.
 *
 * A subset of the engine's RuleConfig - only the parts that make sense as a
 * table setting. Everything here is clamped server-side: it arrives from a
 * client and must not be trusted.
 */
export interface HouseRules {
  /** Cards dealt to each player. */
  startingHand: number;
  /** Mercy Rule threshold. Reach this many cards and you are out. */
  handLimit: number;
  /** Draw cards can be stacked onto an equal-or-lower draw card. */
  stacking: boolean;
  /** 7 swaps hands with a player of your choice. */
  sevenSwap: boolean;
  /** 0 passes every hand in the direction of play. */
  zeroPass: boolean;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  startingHand: 7,
  handLimit: 25,
  stacking: true,
  sevenSwap: true,
  zeroPass: true,
};

/** Bounds enforced by the server. A hand limit below the deal is unplayable. */
export const HOUSE_RULE_LIMITS = {
  startingHand: { min: 3, max: 12 },
  handLimit: { min: 10, max: 60 },
} as const;

export interface RoomSettings {
  botCount: number;
  difficulty: Difficulty;
  maxPlayers: number;
  rules: HouseRules;
}

/** Clamp untrusted house rules into a playable range. */
export function cleanHouseRules(raw: unknown): HouseRules {
  const r = (raw ?? {}) as Partial<HouseRules>;
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(lo, Math.min(hi, Math.floor(v)))
      : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

  const startingHand = num(
    r.startingHand,
    DEFAULT_HOUSE_RULES.startingHand,
    HOUSE_RULE_LIMITS.startingHand.min,
    HOUSE_RULE_LIMITS.startingHand.max,
  );
  const handLimit = num(
    r.handLimit,
    DEFAULT_HOUSE_RULES.handLimit,
    HOUSE_RULE_LIMITS.handLimit.min,
    HOUSE_RULE_LIMITS.handLimit.max,
  );

  return {
    startingHand,
    // A limit at or below the deal would eliminate everyone on the first turn.
    handLimit: Math.max(handLimit, startingHand + 3),
    stacking: bool(r.stacking, DEFAULT_HOUSE_RULES.stacking),
    sevenSwap: bool(r.sevenSwap, DEFAULT_HOUSE_RULES.sevenSwap),
    zeroPass: bool(r.zeroPass, DEFAULT_HOUSE_RULES.zeroPass),
  };
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
