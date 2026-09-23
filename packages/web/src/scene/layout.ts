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
export function ownHandLayout(count: number, selected: number, viewportAspect: number): Transform[] {
  if (count === 0) return [];

  // The fan has to narrow as the hand grows or it runs off the table.
  const maxSpread = viewportAspect < 1 ? 4.6 : 8.2;
  // A small positive gap at low card counts: overlapping cards are harder to
  // aim at, and the hand only needs to fan once it runs out of room.
  const step = Math.min(CARD_W * 1.12, maxSpread / Math.max(1, count - 1));
  const totalWidth = step * (count - 1);
  const arc = Math.min(0.24, 0.05 * count);

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const x = t * totalWidth;
    // A gentle arc: the ends sit slightly further from the camera and lower.
    // Kept well inside the table edge: further back and the near row of
    // cards is clipped by the bottom of the viewport.
    const z = 3.35 - Math.abs(t) * arc * 2.6;
    const isSel = i === selected;

    return {
      pos: [x, isSel ? 0.66 : 0.2 + i * 0.001, isSel ? z - 0.34 : z],
      rot: [
        // Laid back toward the felt, but tipped up to face the camera.
        -Math.PI / 2 + (isSel ? 0.78 : 0.6),
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
