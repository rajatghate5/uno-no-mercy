/**
 * Architecture tests.
 *
 * These guard the structural invariants the design depends on. They are cheap
 * and they fail loudly the moment someone (including future-me) breaks a
 * boundary that the README promises holds.
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
 * ("never calls Math.random") trips the check - which is how this test failed
 * the first time it ran.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}
const rel = (f: string) => f.slice(ROOT.length + 1);

describe('OpenTUI boundary', () => {
  test('only render/runtime.ts imports @opentui', () => {
    const offenders = sourceFiles(join(ROOT, 'packages/tui/src'))
      .filter((f) => /from ['"]@opentui/.test(code(f)))
      .map(rel);

    // If this fails, an OpenTUI import escaped the boundary. Route it through
    // packages/tui/src/render/runtime.ts instead -- that is what makes a
    // pre-1.0 breaking change a one-directory fix.
    expect(offenders).toEqual(['packages/tui/src/render/runtime.ts']);
  });
});

describe('engine purity', () => {
  const engineFiles = sourceFiles(join(ROOT, 'packages/engine/src'));

  test('the engine has no dependencies', () => {
    const pkg = JSON.parse(read(join(ROOT, 'packages/engine/package.json')));
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  test('the engine never imports another package', () => {
    const offenders = engineFiles
      .filter((f) => /from ['"](@uno\/|@opentui|react)/.test(code(f)))
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

  test('the engine performs no I/O', () => {
    const offenders = engineFiles
      .filter((f) => /from ['"]node:|require\(['"]node:|process\.(stdout|stderr)/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('bots fairness', () => {
  test('bots never import the full GameState type', () => {
    // Bots must reason from RedactedState only. Reaching for GameState would
    // let them see hands a human cannot -- that is cheating, not difficulty.
    const src = code(join(ROOT, 'packages/bots/src/index.ts'));
    expect(src).not.toMatch(/\bGameState\b/);
    expect(src).toMatch(/RedactedState/);
  });
});

describe('protocol safety', () => {
  test('server and protocol never trust raw input into a terminal', () => {
    const protocol = read(join(ROOT, 'packages/protocol/src/index.ts'));
    // Names and chat must both be sanitised before they can be printed.
    expect(protocol).toMatch(/export function cleanName/);
    expect(protocol).toMatch(/export function cleanChat/);

    const server = read(join(ROOT, 'packages/server/src/server.ts'));
    expect(server).toMatch(/cleanName\(/);
    expect(server).toMatch(/cleanChat\(/);
  });
});
