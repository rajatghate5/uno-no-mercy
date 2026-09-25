/**
 * The hand has to fit on the screen, or say that it does not.
 *
 * This is the third time the fan has run off both edges of the viewport, each
 * time for a different reason: a hardcoded camera distance, a depth worked out
 * on a plane the cards had moved off, and a caller handing the layout a field
 * of view where a width belonged. The arithmetic is not hard; it is just easy
 * to feed wrong. So the invariant is asserted here rather than re-derived by
 * eye in a browser - for every hand size, on a phone and on a desktop, the row
 * either fits inside the budget it was given or reports exactly the overflow
 * needed to scroll the rest of it into view.
 */

import { describe, expect, test } from 'bun:test';
import { CARD_W, fanMetrics, ownHandLayout } from '../src/scene/layout.js';

/** Budgets as handWidthBudget() measures them: world units visible at the hand. */
const VIEWPORTS = [
  { name: 'phone portrait', aspect: 390 / 844, budget: 4.1 },
  { name: 'tablet portrait', aspect: 820 / 1180, budget: 6.4 },
  { name: 'laptop', aspect: 1440 / 900, budget: 9.6 },
  { name: 'ultrawide', aspect: 2560 / 1080, budget: 16.2 },
];

/** Every hand size the rules can produce, plus the ones they should not. */
const COUNTS = [1, 2, 5, 7, 11, 14, 18, 22, 25, 30];

describe('the hand fits the screen', () => {
  for (const vp of VIEWPORTS) {
    for (const count of COUNTS) {
      test(`${count} cards on a ${vp.name}`, () => {
        const m = fanMetrics(count, vp.aspect, vp.budget);

        // Panned as far as it goes, the outermost card is still fully on screen.
        const edge = m.totalWidth / 2 - m.overflow + m.cardW / 2;
        expect(edge).toBeLessThanOrEqual(vp.budget / 2);

        // A row that fits must not claim to be scrollable, and one that does
        // not fit must claim exactly the shortfall - a hand that overflows
        // without reporting it is the bug that cannot be scrolled back.
        const usable = Math.max(1.2, vp.budget * 0.9 - m.cardW);
        expect(m.overflow).toBe(Math.max(0, (m.totalWidth - usable) / 2));

        // No card is compressed past legibility, however many there are.
        expect(m.step).toBeGreaterThanOrEqual(m.cardW * 0.42 - 1e-9);
      });
    }
  }

  test('a wildly wrong budget cannot be mistaken for a fitting one', () => {
    // The fov-as-width bug: 50 where ~9 belonged. The layout cannot reject the
    // number, but it must not report the result as fitting.
    const bogus = fanMetrics(20, 1.6, 50);
    const real = fanMetrics(20, 1.6, 9.6);
    expect(bogus.totalWidth).toBeGreaterThan(real.totalWidth * 1.5);
    expect(bogus.totalWidth / 2 + bogus.cardW / 2).toBeGreaterThan(9.6 / 2);
  });
});

describe('raising a card', () => {
  const aspect = 1440 / 900;
  const budget = 9.6;

  test('the raised card comes back to full size and clear of the row', () => {
    const rest = ownHandLayout(20, -1, aspect, budget);
    const lifted = ownHandLayout(20, 7, aspect, budget);

    expect(rest[7]!.scale).toBeLessThan(1);
    expect(lifted[7]!.scale).toBe(1);
    expect(lifted[7]!.pos[1]).toBeGreaterThan(rest[7]!.pos[1]);
    // Forward up the screen, into the felt above the hand.
    expect(lifted[7]!.pos[2]).toBeLessThan(rest[7]!.pos[2]);
  });

  test('cards beyond the nudge reach do not move at all', () => {
    const rest = ownHandLayout(20, -1, aspect, budget);
    const lifted = ownHandLayout(20, 7, aspect, budget);

    /*
     * Exactly zero, not merely small. The view skips re-tweening a card whose
     * target is unchanged, and an asymptotic tail worth a hundredth of a card
     * defeats that - every card in the hand restarts its animation on every
     * pointer step, and nothing ever finishes moving.
     */
    for (let i = 0; i < 20; i++) {
      if (Math.abs(i - 7) <= 3) continue;
      expect(lifted[i]!.pos[0]).toBe(rest[i]!.pos[0]);
    }
    // And the immediate neighbours do move, or the lift stays occluded.
    expect(Math.abs(lifted[6]!.pos[0] - rest[6]!.pos[0])).toBeGreaterThan(CARD_W * 0.1);
  });

  test('the end card fits the screen once scrolled to, raised and full size', () => {
    /*
     * Not without the scroll: a twenty-two card hand on a phone is MEANT to run
     * past the edge, which is what the pan exists for. What must hold is that
     * panning to the end brings the end card fully into view - and that it
     * still fits once raised, because a raised card returns to full size and is
     * therefore wider than the slot it came out of.
     */
    for (const vp of VIEWPORTS) {
      const { overflow } = fanMetrics(22, vp.aspect, vp.budget);
      const lifted = ownHandLayout(22, 21, vp.aspect, vp.budget, overflow);
      expect(Math.abs(lifted[21]!.pos[0]) + CARD_W / 2).toBeLessThanOrEqual(vp.budget / 2);
    }
  });
});
