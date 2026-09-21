/**
 * Terminal teardown tests.
 *
 * Regression guard for the bug where quitting left mouse tracking enabled and
 * the shell filled with "35;113;45M35;112;45M..." - raw SGR mouse reports with
 * no app left to read them.
 */
import { describe, expect, test } from 'bun:test';

const ESC = String.fromCharCode(27);

describe('restoreTerminal', () => {
  test('writes every mode a TUI must switch back off', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    // Narrow stub for the duration of this test.
    process.stdout.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    // Fresh module instance, so the once-only guard does not swallow the call.
    const mod = await import(`../src/render/shutdown.js?t=${Math.random()}`);
    mod.restoreTerminal();

    process.stdout.write = original;

    const out = written.join('');
    // 1003 is the one that caused the flood; the rest are the same class of bug.
    expect(out).toContain(`${ESC}[?1003l`);
    expect(out).toContain(`${ESC}[?1006l`);
    expect(out).toContain(`${ESC}[?1002l`);
    expect(out).toContain(`${ESC}[?1000l`);
    expect(out).toContain(`${ESC}[?1015l`);
    expect(out).toContain(`${ESC}[?25h`);
    expect(out).toContain(`${ESC}[?1049l`);
  });

  test('is safe to call twice', async () => {
    const mod = await import(`../src/render/shutdown.js?t=${Math.random()}`);
    expect(() => {
      mod.restoreTerminal();
      mod.restoreTerminal();
    }).not.toThrow();
  });
});

describe('quit path', () => {
  test('main never calls process.exit without restoring the terminal first', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
    // A bare process.exit() in the UI skips renderer.destroy() and leaves mouse
    // reporting on. Quitting must go through quit(), which tears down first.
    const bare = main.match(/process\.exit\(/g) ?? [];
    expect(bare).toHaveLength(0);
    expect(main).toContain('installShutdown(renderer)');
    expect(main).toContain('quit(renderer)');
  });
});
