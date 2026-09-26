/**
 * The ambient card scene behind every menu, lobby and results panel.
 *
 * The menus used to sit on a near-black void: the 3D table was already there,
 * lit and ready, but the panel's scrim was 91% opaque so nothing showed
 * through. A game about cards looked like a settings dialog.
 *
 * This runs a carousel of real card faces - the same textures the table uses,
 * so nothing here is a mock-up - orbiting, turning on the spot, and lifting
 * into a flip.
 *
 * It used to be far slower: one revolution every two and a half minutes and a
 * single flip per card every twenty-six seconds, which meant that in the ten
 * seconds anyone actually spends on the menu you saw no motion at all. The
 * reasoning behind that was sound - this sits behind text people are reading -
 * but it solved the problem by removing the thing instead of placing it. Now
 * the ring is genuinely alive, and the SPLIT layout is what makes that safe:
 * the text lives in two columns with a lit ground under each, and the cards
 * turn in the space between and around them.
 *
 * Three motions, on purpose, because one is a loop and three is a scene:
 * the ring carries every card slowly around the table; each card turns on the
 * spot at its own rate, so no two are ever square to each other; and cards
 * take turns lifting off the felt and flipping over.
 *
 * Driven procedurally from `update(dt)` rather than through the Animator.
 * There is no state to keep in sync and no tween that can be left dangling
 * when a screen closes mid-flight.
 */

import { Group, PointLight, type Scene } from 'three';
import type { Card, CardKind, Color } from '@uno/engine';
import { makeCard, type CardObject } from './card3d.js';

const TAU = Math.PI * 2;

/** Radius of the ring the cards orbit on, in world units. */
const RING = 4.5;
/**
 * How long one full revolution takes, in seconds.
 *
 * Was 150. At that rate a card crosses about four degrees in the time someone
 * reads the menu, which is motion you can measure but not see.
 */
const ORBIT_SECONDS = 58;
/** Fraction of each card's cycle spent in the air. */
const HOP = 0.3;
/** How high a hopping card rises. */
const HOP_HEIGHT = 1.5;
/**
 * How long one card waits between its own flips, in seconds.
 *
 * With sixteen cards each offset by i/n of the cycle, a HOP of 0.3 puts
 * roughly five in the air at any moment - enough that something is always
 * turning over, few enough that the ring never looks like it is boiling.
 */
const HOP_CYCLE = 9;
/**
 * Seconds for a card to turn once on the spot, at the ring's slowest.
 *
 * Each card gets its own rate from this, so the ring never falls into step
 * with itself. A ring of cards all square to the centre reads as a machine
 * part; a ring where every card sits at its own angle reads as a table
 * somebody has been playing at.
 */
const SPIN_SECONDS = 42;
/** How far a card rocks as it drifts, in radians. */
const ROCK = 0.13;

/**
 * What the ring is made of.
 *
 * Weighted toward the cards that are unique to this variant - a menu is the
 * one place the game gets to say what it is, and a ring of plain number cards
 * says "an ordinary card game" rather than "the brutal one".
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
    /*
     * The ring needs its own light, and this is why.
     *
     * The table's lamp is a tight spotlight over the middle - that is the
     * whole Back Room idea - and the ring orbits at 4.5 units, well outside
     * its cone. So the carousel was running the entire time and showing as
     * faint silhouettes: sixteen real card faces, none of them readable. A
     * menu whose one piece of character is invisible reads as bland, and the
     * fix for that is light, not more motion.
     *
     * Parented to the ring's own group, so it goes out with it - an invisible
     * Object3D contributes nothing, which means stop() kills the light too and
     * the table is never lit by scenery that has left the screen.
     */
    const glow = new PointLight('#ffe3b8', 26, 15, 1.7);
    glow.position.set(0, 3.6, 0);
    this.root.add(glow);

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

      /*
       * Each card's own slice of the flip cycle.
       *
       * The i/n offset is what spreads the flips around the ring instead of
       * letting all sixteen turn over at once, which would read as a single
       * shuffling object rather than as sixteen cards.
       */
      const phase = ((this.elapsed / HOP_CYCLE + i / n) % 1 + 1) % 1;
      const hopping = phase < HOP;
      const t = hopping ? phase / HOP : 0;
      // sin gives a rise and fall; squaring the ease makes it leave the felt
      // faster than it lands, which is how a thrown card actually behaves.
      const rise = hopping ? Math.sin(t * Math.PI) ** 0.8 : 0;

      /*
       * A per-card rate that never divides evenly into the others.
       *
       * The 0.37 multiplier on a card's index means the rates are mutually
       * irrational enough that the ring takes hours to repeat a pose. Using
       * i/n instead would have every card back where it started once per
       * orbit, and the loop would be visible.
       */
      const spin = (this.elapsed / (SPIN_SECONDS * (1 + (i * 0.37) % 1))) * TAU;

      // A slow rock, so a card at rest is still breathing rather than pinned.
      const rock = Math.sin(this.elapsed * 0.31 + i * 1.7) * ROCK;

      mesh.position.set(
        Math.cos(angle) * RING,
        0.03 + rise * HOP_HEIGHT,
        Math.sin(angle) * RING,
      );

      /*
       * Euler XYZ, composed as Rx * Ry * Rz - so rot.z is applied FIRST, in
       * the card's own frame, and rot.x lays it flat afterwards.
       *
       * That is why the flip belongs in x (it turns the card face-over-back
       * where it lies) and the spin belongs in z (it turns the card in the
       * plane of the felt). Putting the spin in y would stand it on its edge.
       */
      mesh.rotation.set(
        -Math.PI / 2 + t * TAU,
        rock * (1 - rise),
        spin,
      );
    }
  }
}
