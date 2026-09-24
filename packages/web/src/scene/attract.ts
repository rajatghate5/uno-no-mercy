/**
 * The ambient card scene behind every menu, lobby and results panel.
 *
 * The menus used to sit on a near-black void: the 3D table was already there,
 * lit and ready, but the panel's scrim was 91% opaque so nothing showed
 * through. A game about cards looked like a settings dialog.
 *
 * This runs a slow carousel of real card faces - the same textures the table
 * uses, so nothing here is a mock-up - with one card at a time lifting and
 * flipping over. Deliberately unhurried: it sits BEHIND text that people are
 * reading, and anything quick enough to notice is quick enough to annoy.
 *
 * Driven procedurally from `update(dt)` rather than through the Animator.
 * There is no state to keep in sync and no tween that can be left dangling
 * when a screen closes mid-flight.
 */

import { Group, type Scene } from 'three';
import type { Card, CardKind, Color } from '@uno/engine';
import { makeCard, type CardObject } from './card3d.js';

const TAU = Math.PI * 2;

/** Radius of the ring the cards orbit on, in world units. */
const RING = 4.5;
/** How long one full revolution takes, in seconds. */
const ORBIT_SECONDS = 150;
/** Fraction of each card's cycle spent in the air. */
const HOP = 0.16;
/** How high a hopping card rises. */
const HOP_HEIGHT = 1.15;
/** How long one card waits between its own hops, in seconds. */
const HOP_CYCLE = 26;

/**
 * What the ring is made of.
 *
 * Weighted toward the cards that are unique to No Mercy - a menu is the one
 * place the game gets to say what it is, and a ring of plain number cards
 * says "UNO" rather than "UNO Show 'Em No Mercy".
 */
const SHOWCASE: ReadonlyArray<{ kind: CardKind; color?: Color; rank?: number }> = [
  { kind: 'wildDrawTen' },
  { kind: 'number', color: 'red', rank: 7 },
  { kind: 'skipEveryone', color: 'blue' },
  { kind: 'wildColorRoulette' },
  { kind: 'drawFour', color: 'green' },
  { kind: 'number', color: 'yellow', rank: 0 },
  { kind: 'wildReverseDrawFour' },
  { kind: 'discardAll', color: 'red' },
  { kind: 'drawTwo', color: 'blue' },
  { kind: 'wildDrawSix' },
  { kind: 'skip', color: 'yellow' },
  { kind: 'number', color: 'green', rank: 7 },
  { kind: 'reverse', color: 'red' },
  { kind: 'discardAll', color: 'blue' },
  { kind: 'wildDrawTen' },
  { kind: 'number', color: 'blue', rank: 0 },
];

export class AttractScene {
  private readonly root = new Group();
  private readonly cards: CardObject[] = [];
  private elapsed = 0;
  private running = false;

  constructor(private readonly scene: Scene) {
    SHOWCASE.forEach((spec, i) => {
      const card: Card = {
        id: `attract-${i}`,
        kind: spec.kind,
        ...(spec.color ? { color: spec.color } : {}),
        ...(spec.rank !== undefined ? { rank: spec.rank } : {}),
      };
      const mesh = makeCard(card, card.id);
      // The ring is scenery, not furniture. Casting shadows onto the felt
      // reads as clutter behind a panel, and the cards never touch anything.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.cards.push(mesh);
      this.root.add(mesh);
    });
    this.root.visible = false;
    scene.add(this.root);
  }

  get active(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.root.visible = true;
    // Advance past the opening beat so the ring is already mid-motion when a
    // screen opens, rather than visibly starting from a dead stop.
    this.elapsed = HOP_CYCLE * 0.37;
    this.update(0);
  }

  stop(): void {
    this.running = false;
    this.root.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.cards.length = 0;
  }

  /** @param dt milliseconds since the last frame. */
  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt / 1000;

    const n = this.cards.length;
    const orbit = (this.elapsed / ORBIT_SECONDS) * TAU;

    for (let i = 0; i < n; i++) {
      const mesh = this.cards[i]!;
      const angle = orbit + (i / n) * TAU;

      // Each card gets its own slice of the cycle, so exactly one is in the
      // air at a time and the eye has a single thing to follow.
      const phase = ((this.elapsed / HOP_CYCLE + i / n) % 1 + 1) % 1;
      const hopping = phase < HOP;
      const t = hopping ? phase / HOP : 0;
      const rise = hopping ? Math.sin(t * Math.PI) : 0;

      mesh.position.set(
        Math.cos(angle) * RING,
        0.03 + rise * HOP_HEIGHT,
        Math.sin(angle) * RING,
      );

      // Euler XYZ: rot.x lays the card flat, so carrying the flip there turns
      // it face-over-back in place. rot.z is the in-plane spin, which is what
      // keeps every card square to the middle of the table as the ring turns.
      mesh.rotation.set(
        -Math.PI / 2 + t * TAU,
        0,
        -angle + Math.PI / 2,
      );
    }
  }
}
