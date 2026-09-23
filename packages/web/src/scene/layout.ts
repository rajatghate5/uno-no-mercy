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

export function seatPosition(angle: number, radius: number): [number, number] {
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
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
export const HAND_Z_PORTRAIT = 3.05;

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

export function ownHandLayout(
  count: number,
  selected: number,
  viewportAspect: number,
  /** Visible world-width at the hand, measured from the live camera. */
  widthBudget: number,
): Transform[] {
  if (count === 0) return [];

  // Leave room for a whole card plus a margin, so the outermost card is fully
  // on screen rather than half-cut by the viewport edge.
  const maxSpread = Math.max(1.2, widthBudget * 0.88 - CARD_W);
  // A small positive gap at low card counts: overlapping cards are harder to
  // aim at, and the hand only needs to fan once it runs out of room.
  const step = Math.min(CARD_W * 1.12, maxSpread / Math.max(1, count - 1));
  const totalWidth = step * (count - 1);
  const arc = Math.min(0.24, 0.05 * count);

  const restY = clearance(HAND_TILT);
  const selY = clearance(HAND_TILT_SELECTED) + 0.16;
  // A phone has no room for the arc; flattening it keeps every card reachable.
  const portrait = viewportAspect < 1;

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const x = t * totalWidth;
    // Kept well inside the table edge: further back and the near row of
    // cards is clipped by the bottom of the viewport.
    const z = (portrait ? HAND_Z_PORTRAIT : HAND_Z_LANDSCAPE) - Math.abs(t) * arc * 2.6;
    const isSel = i === selected;

    return {
      // The tiny per-card increment stops coplanar cards z-fighting.
      pos: [x, (isSel ? selY : restY) + i * 0.002, isSel ? z - 0.34 : z],
      rot: [
        // Laid back toward the felt, but tipped up to face the camera.
        -Math.PI / 2 + (isSel ? HAND_TILT_SELECTED : HAND_TILT),
        0,
        -t * arc,
      ],
    } satisfies Transform;
  });
}

/** An opponent's hand: a tight face-down fan at their seat, facing inward. */
export function opponentHandLayout(
  count: number,
  angle: number,
): Transform[] {
  if (count === 0) return [];
  const radius = TABLE_RADIUS - 1.75;
  const [cx, cz] = seatPosition(angle, radius);

  // Cards fan along the tangent at that seat.
  const tangent = angle + Math.PI / 2;
  const tx = Math.cos(tangent);
  const tz = Math.sin(tangent);

  const step = Math.min(0.34, 3.1 / Math.max(1, count - 1));
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
export function seatSpawn(angle: number, isViewer: boolean): Transform {
  if (isViewer) return { pos: [0, 0.9, 3.8], rot: [-Math.PI / 2 + 0.5, 0, 0] };
  const [cx, cz] = seatPosition(angle, TABLE_RADIUS - 1.9);
  return { pos: [cx, 0.9, cz], rot: [-Math.PI / 2, 0, -angle + Math.PI / 2] };
}

/** Where an eliminated or finished player's marker sits. */
export function seatLabelPosition(angle: number): [number, number, number] {
  const [cx, cz] = seatPosition(angle, TABLE_RADIUS - 0.55);
  return [cx, 0.02, cz];
}

export { CARD_W, CARD_H };
