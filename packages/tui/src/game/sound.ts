/**
 * Sound effects.
 *
 * Two tiers, both dependency-free:
 *   - the terminal bell (works everywhere, including over SSH)
 *   - the OS sound player, when one is available
 *
 * Every call is fire-and-forget and swallows failures: a missing audio player
 * must never interrupt a game.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export type Cue = 'play' | 'draw' | 'bigHit' | 'eliminate' | 'win' | 'lose' | 'yourTurn';

/** Built at runtime so this source file holds no literal control bytes. */
const BEL = String.fromCharCode(7);

/** macOS ships these; other platforms fall back to the bell. */
const MAC_SOUNDS: Partial<Record<Cue, string>> = {
  bigHit: '/System/Library/Sounds/Basso.aiff',
  eliminate: '/System/Library/Sounds/Sosumi.aiff',
  win: '/System/Library/Sounds/Glass.aiff',
  lose: '/System/Library/Sounds/Funk.aiff',
  yourTurn: '/System/Library/Sounds/Pop.aiff',
};

export class Sound {
  constructor(public enabled = true) {}

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  play(cue: Cue) {
    if (!this.enabled) return;
    try {
      const file = MAC_SOUNDS[cue];
      if (platform() === 'darwin' && file) {
        // detached + ignored stdio, so the child never blocks or draws over the TUI
        const child = spawn('afplay', [file], { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
        return;
      }
      this.bell(cue === 'bigHit' || cue === 'eliminate' ? 2 : 1);
    } catch {
      // Audio is decoration. Never let it break the game.
    }
  }

  private bell(times: number) {
    for (let i = 0; i < times; i++) process.stdout.write(BEL);
  }
}
