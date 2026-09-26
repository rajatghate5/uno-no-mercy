/**
 * The surface the Table screen renders against.
 *
 * LocalGame (bots, in-process) and NetworkGame (LAN, server-authoritative)
 * both satisfy this, so the table has exactly one implementation and no
 * "if networked" branches. Anything the two modes genuinely differ on is
 * optional here.
 */

import type { Action, GameEvent, RedactedState } from '@mercy/engine';
import type { ChatMessage } from '@mercy/protocol';
import type { LogEntry } from './narrate.js';

export interface PlayableGame {
  view(): RedactedState | null;
  subscribe(fn: () => void): () => void;
  apply(action: Action): boolean;
  waitingOnHuman(): boolean;
  readonly isOver: boolean;
  readonly winner: string | null;
  readonly log: LogEntry[];
  readonly lastEvents: GameEvent[];
  /** Present only for networked games. */
  readonly chat?: ChatMessage[];
  say?(text: string): void;
  /** Networked games only: tell the table you are mid-sentence. */
  setTyping?(typing: boolean): void;
  /** Networked games only: who is mid-sentence right now. */
  typingNames?(): string[];
  /** The viewer's own player id. */
  readonly youId: string;
  readonly spectator?: boolean;
}
