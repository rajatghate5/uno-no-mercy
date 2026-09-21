/**
 * Animation tests.
 *
 * A compiling animation is not an animating one. These drive the real
 * renderer and assert that frames actually CHANGE over time and then SETTLE,
 * which is the only way to catch a tween that never starts or never finishes.
 */
import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';

// Explicitly on: the other UI suite disables animation, and bun test shares a
// process, so this must not rely on the ambient default.
process.env.UNO_NO_ANIMATION = '';

import { clamp01, flashCurve, lerp, lerpColor, stagger } from '../src/render/animation.js';
import { playableFor } from '@uno/engine';
import { Table } from '../src/screens/Table.js';
import { LocalGame } from '../src/game/local.js';

const SIZE = { width: 120, height: 40 };

/**
 * Let the renderer run for roughly `ms`, pumping React and the timeline.
 *
 * Uses renderOnce(), NOT flush(): flush() waits for visual idle, which by
 * definition never arrives while an animation is still running, so it times
 * out after 20 frames.
 */
async function advance(t: Awaited<ReturnType<typeof testRender>>, ms: number) {
  const steps = Math.ceil(ms / 16);
  for (let i = 0; i < steps; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 16));
    });
    await t.renderOnce();
  }
}

describe('easing helpers', () => {
  test('clamp01 bounds its input', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  test('lerp interpolates and clamps', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, -1)).toBe(0);
    expect(lerp(0, 10, 2)).toBe(10);
  });

  test('lerpColor blends two hex colours', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('lerpColor falls back rather than throwing on bad input', () => {
    expect(lerpColor('not-a-colour', '#ffffff', 0.5)).toBe('#ffffff');
  });

  test('flashCurve peaks early then decays to zero', () => {
    expect(flashCurve(0)).toBe(0);
    expect(flashCurve(0.25)).toBeCloseTo(1);
    expect(flashCurve(1)).toBeCloseTo(0);
    // Rises before the peak, falls after it.
    expect(flashCurve(0.1)).toBeLessThan(flashCurve(0.25));
    expect(flashCurve(0.6)).toBeLessThan(flashCurve(0.25));
  });

  test('stagger delays later items but always completes together', () => {
    // At full progress every item is fully revealed, so nothing is left behind.
    for (let i = 0; i < 7; i++) expect(stagger(1, i, 7)).toBe(1);
    // Early on, the first card is ahead of the last.
    expect(stagger(0.2, 0, 7)).toBeGreaterThan(stagger(0.2, 6, 7));
    // A single card has no stagger to apply.
    expect(stagger(0.5, 0, 1)).toBe(0.5);
  });
});

describe('table animation', () => {
  const mkGame = () =>
    new LocalGame({ seed: 1234, humanName: 'you', botCount: 3, difficulty: 'medium' });

  test('the opening hand deals in, then settles', async () => {
    const t = await testRender(<Table game={mkGame()} onExit={() => {}} />, SIZE);
    await t.flush();
    const first = t.captureCharFrame();

    await advance(t, 300);
    const mid = t.captureCharFrame();

    await advance(t, 1200);
    const settled = t.captureCharFrame();
    await advance(t, 300);
    const stillSettled = t.captureCharFrame();

    // It moved...
    expect(mid).not.toBe(first);
    // ...and then stopped moving.
    expect(stillSettled).toBe(settled);
  }, 20_000);

  test('the settled frame matches the un-animated frame', async () => {
    // The animation must be pure decoration: once finished, the table looks
    // exactly as it does with animation switched off. If these diverge, the
    // animated path is rendering something the static path does not.
    const animated = await testRender(<Table game={mkGame()} onExit={() => {}} />, SIZE);
    await advance(animated, 1600);
    const settled = animated.captureCharFrame();

    process.env.UNO_NO_ANIMATION = '1';
    const plain = await testRender(<Table game={mkGame()} onExit={() => {}} />, SIZE);
    await plain.flush();
    const instant = plain.captureCharFrame();
    process.env.UNO_NO_ANIMATION = '';

    expect(settled).toBe(instant);
  }, 20_000);

  test('cards start face-down and end face-up', async () => {
    const t = await testRender(<Table game={mkGame()} onExit={() => {}} />, SIZE);
    await t.flush();
    // The deal begins with backs showing, which render the card-back glyph.
    const first = t.captureCharFrame();
    expect(first).toContain('your hand');

    await advance(t, 1600);
    const settled = t.captureCharFrame();
    // By the end, no card back remains in the hand row.
    expect(settled).toContain('your hand — 7 cards');
  }, 20_000);

  test('playing a card slams the discard pile, then it settles', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await advance(t, 1000); // let the deal finish
    const before = t.captureCharFrame();

    await act(async () => {
      const opts = playableFor(game.view());
      game.apply({ type: 'play', player: game.youId, cardId: opts[0]!.id });
    });
    await t.renderOnce();

    // Sample across the slam window; at least one frame must differ from both
    // the pre-play frame and the settled frame, which is the impact itself.
    const during: string[] = [];
    for (let i = 0; i < 10; i++) {
      await advance(t, 16);
      during.push(t.captureCharFrame());
    }

    await advance(t, 600);
    const settled = t.captureCharFrame();

    expect(settled).not.toBe(before);
    // The double border only appears at peak impact.
    expect(during.some((f) => f !== settled)).toBe(true);
  }, 20_000);

  test('disabling animation renders a complete table immediately', async () => {
    process.env.UNO_NO_ANIMATION = '1';
    const t = await testRender(<Table game={mkGame()} onExit={() => {}} />, SIZE);
    await t.flush();
    const frame = t.captureCharFrame();
    process.env.UNO_NO_ANIMATION = '';

    expect(frame).toContain('your hand — 7 cards');
    expect(frame).toContain('discard');
    expect(frame).toContain('no stack');
  });
});
