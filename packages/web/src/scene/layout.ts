/**
 * Where everything sits on the table.
 *
 * Pure maths, no Three objects, so the layout can be reasoned about (and
 * tested) without a WebGL context.
 *
 * Axes: +X right, +Y up, +Z toward the camera. The felt is the Y=0 plane, so
 * a card lying flat has rotation.x = -PI/2.
 */

import { CARD_H, CARD_W } from './card3d.js';
import { TABLE_RADIUS } from './table.js';

export interface Transform {
  pos: [number, number, number];
  rot: [number, number, number];
  /** Uniform mesh scale. Only the viewer's own hand ever uses anything but 1. */
  scale?: number;
}

/** Stack heights, so piles do not z-fight with the felt or each other. */
const LIFT = 0.012;

export const DISCARD_AT: [number, number] = [0.95, 0];
export const DRAW_AT: [number, number] = [-0.95, 0];

/**
 * Seat angle for a player, in radians around the table.
 *
 * The viewer always sits at the bottom of the screen (facing +Z) whatever
 * their index in the state, so the table rotates around them rather than them
 * hopping seats between games.
 */
export function seatAngle(index: number, viewerIndex: number, count: number): number {
  const offset = (index - viewerIndex + count) % count;
  // Bottom of the screen is +Z, which is angle PI/2 in this XZ convention.
  return Math.PI / 2 + (offset * Math.PI * 2) / count;
}

/**
 * How much the seating ring is squashed horizontally.
 *
 * A round table framed by a portrait camera puts the left and right seats
 * outside the frustum entirely - on a phone those two players had a floating
 * name label and no cards anywhere on screen. Squashing the ring into an
 * ellipse pulls them back into frame without moving the felt, the piles, or
 * the seat the viewer occupies.
 *
 * 1 means an untouched circle, which is what any landscape viewport gets.
 */
export function seatSqueeze(aspect: number): number {
  if (aspect >= 1) return 1;
  // Ramps from a full circle at square down to 0.46 on a tall phone.
  return Math.max(0.46, 0.46 + (aspect - 0.5) * 1.0);
}

export function seatPosition(angle: number, radius: number, squeeze = 1): [number, number] {
  return [Math.cos(angle) * radius * squeeze, Math.sin(angle) * radius];
}

/**
 * Euler order note (applies to every transform below).
 *
 * Three composes XYZ as R = Rx * Ry * Rz, so Rz is applied to the card FIRST,
 * in its own local frame, and Rx lays it flat afterwards. That makes rot.z the
 * in-plane spin and rot.y a tilt OUT of the table - which is why seat rotation
 * belongs in z. Putting it in y stands the cards on their edge.
 */

/**
 * The viewer's own hand: a shallow arc across the bottom, tilted up toward
 * the camera so the faces are readable rather than foreshortened.
 */
/** How far the hand is tilted up from flat, in radians. */
const HAND_TILT = 0.6;
const HAND_TILT_SELECTED = 0.78;

/**
 * Minimum height a tilted card's CENTRE must sit at for its bottom edge to
 * clear the felt.
 *
 * A card tilted by `tilt` dips (CARD_H / 2) * sin(tilt) below its own centre.
 * Lift it less than that and the table plane cuts the bottom off the card -
 * which is exactly what happened with a hardcoded 0.2 against a 0.6 tilt.
 */
function clearance(tilt: number): number {
  return (CARD_H / 2) * Math.sin(tilt) + 0.04;
}

/** Where the hand sits, so the camera can be measured against it. */
export const HAND_Z_LANDSCAPE = 3.35;
/**
 * Further forward than landscape, not further back.
 *
 * With the portrait camera pulled back to fit the table, a hand at the old
 * 3.05 sat two thirds up the screen with a dead band of felt beneath it. The
 * hand belongs at the near edge - that is where a player's own cards are.
 */
export const HAND_Z_PORTRAIT = 4.6;

/**
 * How wide the camera can actually see at the hand, in world units.
 *
 * `distance` must be measured from the REAL camera. Hardcoding it produced a
 * portrait fan wider than the viewport, because the portrait camera sits
 * ~1.3 units closer than the landscape one and the hardcoded value was the
 * landscape figure.
 */
export function visibleWidthAtHand(
  aspect: number,
  fovDegrees: number,
  distance: number,
): number {
  const halfFov = (fovDegrees * Math.PI) / 180 / 2;
  return 2 * distance * Math.tan(halfFov) * aspect;
}

/** Where the hand stops showing whole cards and becomes a real fan. */
const FAN_FROM = 11;
/** Where the shrink bottoms out. Past this, more cards just means thinner slivers. */
const FAN_TO = 22;
/** How small a card gets in the densest fan, as a fraction of its normal size. */
const FAN_MIN_SCALE = 0.78;
/**
 * The narrowest sliver a card is allowed to show, as a fraction of its width.
 *
 * This is the floor that makes the hand scrollable rather than infinitely
 * compressible. Without it, twenty-five cards on a phone were squeezed into
 * whatever width happened to be going, and the answer was "not enough to see".
 * Better to keep every card readable and let the row run off the edge, so
 * long as you can move the row.
 */
const MIN_STEP = 0.42;

/** How many cards either side of the raised one shuffle out of its way. */
const NUDGE_REACH = 3;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface FanMetrics {
  scale: number;
  cardW: number;
  step: number;
  totalWidth: number;
  baseZ: number;
  arc: number;
  /** How far the row may be panned each way, in world units. 0 if it fits. */
  overflow: number;
}

/**
 * Everything about the shape of the fan, in one place.
 *
 * Shared deliberately: the camera-facing code needs the same depth the layout
 * uses, and the scroll clamp needs the same width. An earlier version worked
 * the depth out separately, which was fine until the layout started moving
 * the row - after which the width budget was measured at a plane the cards
 * were no longer on, and the fan quietly overflowed the viewport.
 */
export function fanMetrics(count: number, viewportAspect: number, widthBudget: number): FanMetrics {
  const portrait = viewportAspect < 1;
  const fan = clamp01((count - FAN_FROM) / (FAN_TO - FAN_FROM));
  const scale = lerp(1, FAN_MIN_SCALE, fan);
  const cardW = CARD_W * scale;

  // Leave room for a whole card plus a margin, so the outermost card is fully
  // on screen rather than half-cut by the viewport edge.
  const usable = Math.max(1.2, widthBudget * 0.9 - cardW);
  const ideal = usable / Math.max(1, count - 1);
  // A small positive gap at low card counts, a readable sliver at high ones.
  const step = Math.min(cardW * 1.12, Math.max(cardW * MIN_STEP, ideal));
  const totalWidth = step * (count - 1);
  const arc = Math.min(portrait ? 0.14 : 0.24, 0.05 * count) * lerp(1, 0.6, fan);

  return {
    scale,
    cardW,
    step,
    totalWidth,
    baseZ: handDepth(count, viewportAspect),
    arc,
    overflow: Math.max(0, (totalWidth - usable) / 2),
  };
}

/** How far from the camera the hand row sits, for a hand of this size. */
export function handDepth(count: number, viewportAspect: number): number {
  const portrait = viewportAspect < 1;
  const fan = clamp01((count - FAN_FROM) / (FAN_TO - FAN_FROM));
  /*
   * Shrinking the cards already lifts their bottom edge clear of the
   * viewport, so this only has to make up the difference. Landscape gives a
   * touch of push-back; portrait moves the row the other way, TOWARD the
   * camera, because on a phone a shrunken hand otherwise leaves a band of
   * empty felt below it the size of the hand itself.
   */
  return (portrait ? HAND_Z_PORTRAIT : HAND_Z_LANDSCAPE) + lerp(0, portrait ? 0.5 : -0.2, fan);
}

/**
 * The viewer's own hand.
 *
 * Small hands lie in a gentle arc at full size. Past about eleven cards the
 * hand becomes a fan you would actually hold: the cards shrink, slide back
 * away from the camera, and overlap down to a readable sliver each.
 *
 * The shrink is not decoration. At twenty-two cards the old layout kept every
 * card at full size, which pushed the row past the bottom of the viewport and
 * cut roughly the lower half off every one of them - so the hand that most
 * needs reading was the one you could not read.
 *
 * Past MIN_STEP the fan stops compressing and starts OVERFLOWING, and
 * `scrollX` slides it. That is the deliberate trade: on a narrow screen a
 * twenty-five card hand cannot be both fully visible and legible, and legible
 * with a scroll beats visible and useless.
 *
 * Whichever card is selected always comes back to FULL size and lifts clear
 * of the fan, which is what makes a sliver-width fan usable: you point at a
 * card and it steps out of the row to show you what it is.
 */
export function ownHandLayout(
  count: number,
  selected: number,
  viewportAspect: number,
  /** Visible world-width at the hand, measured from the live camera. */
  widthBudget: number,
  /** How far the row is panned, in world units. Clamped by the caller. */
  scrollX = 0,
): Transform[] {
  if (count === 0) return [];

  const m = fanMetrics(count, viewportAspect, widthBudget);
  const restY = clearance(HAND_TILT) * m.scale;

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const isSel = i === selected;

    /*
     * Neighbours step aside for the raised card.
     *
     * Without this the lifted card still has its immediate neighbours
     * overlapping its edges, which is exactly the occlusion the lift exists
     * to undo. The push falls off fast, so the rest of the fan does not slide
     * around every time the pointer moves.
     *
     * Past NUDGE_REACH it is cut to exactly zero rather than left to trail off
     * asymptotically. The tail was worth about a hundredth of a card, far too
     * little to see, but it made every card in the hand a card whose target
     * MOVED on every pointer step - so the whole fan restarted its tween
     * thirty times a second while the pointer swept across it. Zero is a
     * target the view can recognise as unchanged and leave alone.
     */
    const d = Math.abs(i - selected);
    const away = selected >= 0 && !isSel && d <= NUDGE_REACH ? Math.sign(i - selected) : 0;
    const nudge = away === 0 ? 0 : away * m.step * 0.55 * Math.exp(-d / 1.6);

    const x = t * m.totalWidth + nudge - scrollX;
    const z = m.baseZ - Math.abs(t) * m.arc * 2.6;

    if (isSel) {
      return {
        // Full size and clear of the row: up off the felt, and forward up the
        // screen into the empty felt above the hand rather than toward the
        // camera, where there is no room left.
        pos: [x, clearance(HAND_TILT_SELECTED) + 0.34, z - CARD_H * 0.62],
        rot: [-Math.PI / 2 + HAND_TILT_SELECTED, 0, 0],
        scale: 1,
      } satisfies Transform;
    }

    return {
      // The tiny per-card increment stops coplanar cards z-fighting.
      pos: [x, restY + i * 0.002, z],
      rot: [
        // Laid back toward the felt, but tipped up to face the camera.
        -Math.PI / 2 + HAND_TILT,
        0,
        -t * m.arc,
      ],
      scale: m.scale,
    } satisfies Transform;
  });
}

/** An opponent's hand: a tight face-down fan at their seat, facing inward. */
export function opponentHandLayout(
  count: number,
  angle: number,
  squeeze = 1,
): Transform[] {
  if (count === 0) return [];
  const radius = TABLE_RADIUS - 1.75;
  const [cx, cz] = seatPosition(angle, radius, squeeze);

  // Cards fan along the tangent at that seat.
  const tangent = angle + Math.PI / 2;
  const tx = Math.cos(tangent);
  const tz = Math.sin(tangent);

  // A squeezed ring puts the side seats close to the piles, so the fan has to
  // narrow by the same amount or it lands on top of the discard.
  const span = 3.1 * squeeze;
  const step = Math.min(0.34, span / Math.max(1, count - 1));
  const total = step * (count - 1);

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const d = t * total;
    return {
      pos: [cx + tx * d, LIFT + i * 0.004, cz + tz * d],
      rot: [-Math.PI / 2, 0, -angle + Math.PI / 2],
    } satisfies Transform;
  });
}

/**
 * The discard pile. Each card is dropped at a slightly different angle so the
 * pile looks thrown down rather than machine-stacked.
 */
export function discardTransform(depth: number, seed: number): Transform {
  const jitter = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1);
  return {
    pos: [
      DISCARD_AT[0] + jitter(1) * 0.1,
      LIFT + depth * 0.014,
      DISCARD_AT[1] + jitter(2) * 0.1,
    ],
    rot: [-Math.PI / 2, 0, jitter(3) * 0.5],
  };
}

/** The face-down draw pile. Neat, because nobody throws the draw pile. */
export function drawTransform(depth: number): Transform {
  return {
    pos: [DRAW_AT[0], LIFT + depth * 0.012, DRAW_AT[1]],
    rot: [-Math.PI / 2, Math.PI, depth * 0.006],
  };
}

/** Where a card should be born when a given seat plays it. */
export function seatSpawn(angle: number, isViewer: boolean, squeeze = 1): Transform {
  if (isViewer) return { pos: [0, 0.9, 3.8], rot: [-Math.PI / 2 + 0.5, 0, 0] };
  const [cx, cz] = seatPosition(angle, TABLE_RADIUS - 1.9, squeeze);
  return { pos: [cx, 0.9, cz], rot: [-Math.PI / 2, 0, -angle + Math.PI / 2] };
}

/** Where an eliminated or finished player's marker sits. */
export function seatLabelPosition(angle: number, squeeze = 1): [number, number, number] {
  const [cx, cz] = seatPosition(angle, TABLE_RADIUS - 0.55, squeeze);
  return [cx, 0.02, cz];
}

export { CARD_W, CARD_H };
