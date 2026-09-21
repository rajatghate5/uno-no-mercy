/**
 * Terminal teardown.
 *
 * A TUI puts the terminal into modes the shell knows nothing about: the
 * alternate screen, a hidden cursor, and - the one that bites - mouse
 * tracking. If the process exits without turning those off, the terminal keeps
 * reporting every mouse move, and with no app reading them they land in the
 * shell as text like "35;113;45M35;112;45M..." until you run `reset`.
 *
 * Two layers, because one is not enough:
 *
 *  1. renderer.destroy(), which is OpenTUI's own clean shutdown.
 *  2. Raw escape sequences written straight to stdout, as a backstop for the
 *     cases destroy() never gets to run - a crash, a signal, a throw during
 *     teardown itself.
 *
 * Layer 2 is deliberately redundant. Re-disabling a mode that is already
 * disabled is harmless; leaving mouse reporting on is not.
 */

import type { CliRenderer } from './runtime.js';

const ESC = String.fromCharCode(27);

/** Modes a TUI turns on and MUST turn back off. */
const RESTORE = [
  `${ESC}[?1000l`, // X11 mouse reporting
  `${ESC}[?1002l`, // button-event tracking
  `${ESC}[?1003l`, // any-event tracking  <- the one that floods the shell
  `${ESC}[?1006l`, // SGR extended mouse mode
  `${ESC}[?1015l`, // urxvt extended mouse mode
  `${ESC}[?2004l`, // bracketed paste
  `${ESC}[?25h`, //  show the cursor again
  `${ESC}[?1049l`, // leave the alternate screen
  `${ESC}[0m`, //    reset colours and attributes
].join('');

let installed = false;
let cleaned = false;

/** Write the restore sequences directly. Safe to call more than once. */
export function restoreTerminal(): void {
  if (cleaned) return;
  cleaned = true;
  try {
    process.stdout.write(RESTORE);
  } catch {
    // Exiting anyway; a failed write here must not mask the original error.
  }
}

/**
 * Register teardown for every way this process can end.
 *
 * Call once at startup. `exit` covers normal returns and process.exit();
 * the signals cover Ctrl-C and kill; the last two cover crashes.
 */
export function installShutdown(renderer: CliRenderer): void {
  if (installed) return;
  installed = true;

  const shutdown = (code: number) => {
    try {
      renderer.destroy();
    } catch {
      // destroy() can throw mid-render; the raw restore below still runs.
    }
    restoreTerminal();
    process.exit(code);
  };

  // Normal exit: no process.exit() here, we are already exiting.
  process.on('exit', () => {
    try {
      renderer.destroy();
    } catch {
      /* ignore */
    }
    restoreTerminal();
  });

  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));
  process.on('SIGHUP', () => shutdown(129));

  process.on('uncaughtException', (err) => {
    restoreTerminal();
    console.error(err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    restoreTerminal();
    console.error(err);
    process.exit(1);
  });
}

/** The app's own quit path. Restores the terminal, then exits. */
export function quit(renderer: CliRenderer, code = 0): never {
  try {
    renderer.destroy();
  } catch {
    /* ignore */
  }
  restoreTerminal();
  process.exit(code);
}
