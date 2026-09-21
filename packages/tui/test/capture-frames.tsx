/**
 * Capture real animation frames from the TUI renderer, with colour.
 *
 * Seed 390 is chosen deliberately (see find-seed.ts): the opening hand holds
 * six power cards - Color Roulette, a coloured +4, Wild +10, Skip and Wild
 * Reverse +4 - and a draw stack reaches +46 by turn ten. It is a real seeded
 * game, not a staged hand.
 *
 * Format: colours are pooled into a palette and each row keeps the renderer's
 * own run-length spans. Exploding spans into per-character cells produced a
 * 17MB file for 109 frames; this keeps it near 100KB per hundred.
 */
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
process.env.UNO_NO_ANIMATION = '';
import { decide, emptyMemory } from '@uno/bots';
import { Table } from '../src/screens/Table.js';
import { LocalGame } from '../src/game/local.js';

const WIDTH = 96;
const HEIGHT = 32;
const FRAME_MS = 45;
const SEED = 390;

const game = new LocalGame({ seed: SEED, humanName: 'rajat', botCount: 3, difficulty: 'hard' });
const t = await testRender(<Table game={game} onExit={() => {}} />, { width: WIDTH, height: HEIGHT });

type Run = [string, number, number, number];
type Row = Run[];

const palette: string[] = [];
const paletteIndex = new Map<string, number>();
function color(c: { r: number; g: number; b: number }): number {
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const hex = `#${to(c.r)}${to(c.g)}${to(c.b)}`;
  let i = paletteIndex.get(hex);
  if (i === undefined) {
    i = palette.length;
    palette.push(hex);
    paletteIndex.set(hex, i);
  }
  return i;
}

const frames: { rows: Row[]; label: string; hold: number }[] = [];
let label = 'dealing the hand';

function grab() {
  const captured = t.captureSpans();
  const rows: Row[] = captured.lines.map((line) =>
    line.spans.map((s) => [s.text, color(s.fg), color(s.bg), s.attributes & 1] as Run),
  );
  const key = JSON.stringify(rows);
  const last = frames[frames.length - 1];
  // Identical consecutive frames become a hold, not a duplicate payload.
  if (last && last.label === label && JSON.stringify(last.rows) === key) {
    last.hold++;
    return;
  }
  frames.push({ rows, label, hold: 1 });
}

async function step(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 8));
    });
    await t.renderOnce();
  }
}

/** Run one decision for whoever is up, using the bot brain for every seat. */
let rng = SEED ^ 0x77;
async function turn() {
  if (game.isOver) return false;
  const actor = game.actorId();
  const view = actor === game.youId ? game.view() : null;
  await act(async () => {
    if (actor === game.youId && view) {
      const d = decide('hard', view, rng, emptyMemory());
      rng = d.rng;
      game.apply(d.action);
    } else {
      game.stepBot();
    }
  });
  await t.renderOnce();
  return true;
}

// --- 1. the deal, showing the power cards ---------------------------------
grab();
for (let i = 0; i < 44; i++) {
  await step();
  grab();
}
label = 'a hand full of power cards';
for (let i = 0; i < 10; i++) {
  await step();
  grab();
}

// --- 2. play out the game, narrating by what is actually happening --------
let lastStack = 0;
for (let n = 0; n < 34 && !game.isOver; n++) {
  const before = game.raw.players.filter((p) => p.eliminated).length;
  await turn();
  const v = game.view();
  const stack = v?.pendingDraw ?? 0;
  const after = game.raw.players.filter((p) => p.eliminated).length;

  if (after > before) label = 'ELIMINATED - 25 cards';
  else if (stack > lastStack && stack >= 10) label = `the stack climbs to +${stack}`;
  else if (stack > lastStack) label = `draw stack +${stack}`;
  else if (lastStack > 0 && stack === 0) label = `somebody ate +${lastStack}`;
  else label = 'play continues';
  lastStack = stack;

  // Sample through the animation window for this move.
  for (let i = 0; i < 9; i++) {
    await step();
    grab();
  }
}

const out = { width: WIDTH, height: HEIGHT, frameMs: FRAME_MS, seed: SEED, palette, frames };
const json = JSON.stringify(out);
await Bun.write('/tmp/uno-frames.json', json);
console.log(`captured ${frames.length} unique frames from seed ${SEED}`);
console.log(`palette: ${palette.length} colours | size: ${(json.length / 1024).toFixed(0)}KB`);
const seen = new Set(frames.map((f) => f.label));
console.log('phases:', [...seen].join(' | '));
process.exit(0);
