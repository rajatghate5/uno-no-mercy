/**
 * Architecture tests.
 *
 * Structural invariants the design depends on. They are cheap and they fail
 * loudly the moment a boundary the README promises gets crossed.
 *
 * These survived the move from a terminal UI to a WebGL one unchanged, which
 * is the point: none of them were ever about the renderer.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const read = (f: string) => readFileSync(f, 'utf8');

/**
 * Strip comments before scanning for banned constructs.
 *
 * Without this, a doc comment that merely NAMES the thing it forbids
 * ("never calls Math.random") trips the check.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const rel = (f: string) => f.slice(ROOT.length + 1);

describe('engine purity', () => {
  const engineFiles = sourceFiles(join(ROOT, 'packages/engine/src'));

  test('the engine has no dependencies', () => {
    const pkg = JSON.parse(read(join(ROOT, 'packages/engine/package.json')));
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  test('the engine never imports another package', () => {
    const offenders = engineFiles
      .filter((f) => /from ['"](@uno\/|three|react)/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('the engine never uses Math.random, Date.now or new Date', () => {
    // Determinism is what makes replays exact and failing seeds reproducible.
    const offenders = engineFiles
      .filter((f) => /Math\.random|Date\.now|new Date\(/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('the engine performs no I/O and touches no DOM', () => {
    const offenders = engineFiles
      .filter((f) =>
        /from ['"]node:|require\(['"]node:|process\.(stdout|stderr)|\bdocument\.|\bwindow\./.test(
          code(f),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('bot fairness', () => {
  test('bots never reference the full GameState', () => {
    // Bots must reason from RedactedState only. Reaching for GameState would
    // let them see hands a human cannot - cheating, not difficulty.
    const src = code(join(ROOT, 'packages/bots/src/index.ts'));
    expect(src).not.toMatch(/\bGameState\b/);
    expect(src).toMatch(/RedactedState/);
  });

  test('bots do not import the renderer or the DOM', () => {
    const src = code(join(ROOT, 'packages/bots/src/index.ts'));
    expect(src).not.toMatch(/three|document\.|window\./);
  });
});

describe('protocol safety', () => {
  test('names and chat are sanitised before they can reach a screen', () => {
    const protocol = code(join(ROOT, 'packages/protocol/src/index.ts'));
    expect(protocol).toMatch(/export function cleanName/);
    expect(protocol).toMatch(/export function cleanChat/);

    const server = code(join(ROOT, 'packages/server/src/server.ts'));
    expect(server).toMatch(/cleanName\(/);
    expect(server).toMatch(/cleanChat\(/);
  });
});

describe('client boundary', () => {
  const webFiles = sourceFiles(join(ROOT, 'packages/web/src'));

  test('game controllers stay free of Three.js', () => {
    // local.ts / network.ts survived the TUI-to-WebGL move untouched because
    // they never knew about the renderer. Keep it that way.
    const offenders = webFiles
      .filter((f) => f.includes('/game/'))
      .filter((f) => /from ['"]three/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('scene code never imports the UI layer', () => {
    const offenders = webFiles
      .filter((f) => f.includes('/scene/'))
      .filter((f) => /from ['"]\.\.\/ui\//.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
