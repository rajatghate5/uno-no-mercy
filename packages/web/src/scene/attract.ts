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

/*
 * The ring is an ELLIPSE, not a circle, and it is pushed away from the viewer.
 *
 * It was a circle of radius 4.5, and it was being sliced off along the bottom
 * of the window. Measured against the live camera by walking a point across
 * the felt and asking where it leaves the frame, landscape sees the felt from
 * z = +4.10 (the bottom edge of the screen) back to z = -11.28, and the
 * half-width available runs from 5.53 at the near edge to 7.29 at the middle.
 *
 * So what the camera sees is a TRAPEZOID - shallow and narrow near the viewer,
 * deep and wide away from them - and a circle cannot fit inside one. At radius
 * 4.5 the ring put card edges at z = 5.25 against a limit of 4.10, hanging
 * 1.15 units below the frame, while never reaching the width available at
 * either side. It was not too big; it was the wrong shape.
 *
 * These numbers put the near arc at 3.0 + 0.75 for half a card = 3.75, which
 * clears the bottom by 0.35. The far arc lands at -4.6, well inside -11.28.
 * The widest point of the ellipse falls at z = RING_OFFSET_Z, where there is
 * about 7.6 of half-width to play with, so 6.0 + half a card fits easily.
 */
/**
 * Depth and offset, per camera shape.
 *
 * createStage() switches the camera at aspect 1 - fov 42 and a lower seat in
 * landscape, fov 62 and a higher one in portrait - and the VERTICAL fov is
 * what decides how much depth is visible. So depth is two discrete cases
 * matching that switch, not a ramp across it: landscape sees the felt from
 * z = +4.10 back to -11.28, portrait from +6.83 back to -22.88.
 *
 * Portrait therefore gets a far deeper ring. With the width squeezed down to
 * fit a phone, a landscape-depth ring would sit entirely behind the menu
 * text, and the first version of this fix did exactly that - it cleared the
 * edges by hiding the carousel completely.
 */
const RING_Z_LANDSCAPE = 3.8;
const RING_Z_PORTRAIT = 7.6;
const OFFSET_Z_LANDSCAPE = -0.8;
const OFFSET_Z_PORTRAIT = -2.0;
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
 * How high a resting card floats above the felt.
 *
 * THIS IS THE CUT. It was 0.03, which was fine while the cards lay dead flat,
 * and stopped being fine the moment they were given a rock: a card's corner is
 * 0.901 units from its centre, so tipping it ROCK radians drops that corner
 * 0.901 * sin(0.13) = 0.117 - a full 0.087 BELOW the table. The felt then
 * clips it, and because the felt is a plane the clip is a perfectly straight
 * line across the card. It reads exactly as if the card had been sliced off,
 * which is precisely what has happened.
 *
 * 0.18 clears the worst case with margin. These cards cast no shadow, so
 * floating them fractionally higher costs nothing visually.
 */
const REST_Y = 0.18;

/**
 * What the ring is made of.
 *
 * Weighted toward the cards that are unique to this variant - a menu is the
 * one place the game gets to say what it is, and a ring of plain number cards
 * says "an ordinary card game" rather than "the brutal one".
 */
/**
 * The ring's shape for a given viewport.
 *
 * Width and depth behave differently, and that is the whole reason this is a
 * function rather than three constants.
 *
 * WIDTH scales continuously: the half-width the camera can see at a given
 * depth is directly proportional to the aspect ratio, so the ring can grow
 * and shrink smoothly as a window is dragged. Landscape at 1.6 has 5.53 units
 * of half-width at the near edge; PORTRAIT HAS 2.53, which is why a ring
 * sized for a laptop throws cards off both sides of a phone.
 *
 * DEPTH cannot ramp, because the camera does not: it switches shape at aspect
 * 1 and takes its vertical fov with it. Ramping across that would put the
 * ring in a shape the camera is not using.
 */
function ringShape(aspect: number): { rx: number; rz: number; offsetZ: number } {
  const portrait = aspect < 1;
  return {
    /*
     * Clamped to the LAMP's reach, not the camera's.
     *
     * This was 6.2, sized from how much width the CAMERA can see - and that
     * was wrong in a way an edge-contact test cannot catch. The room has one
     * spotlight, at y = 9.4 with a half-angle of 0.56 rad and penumbra 0.82,
     * so the pool it throws is roughly 5.9 across at the felt and fading for
     * most of the way out. Measured off a real screenshot, a card orbiting at
     * radius 5 peaks at luminance 15-30 out of 255, while one at radius 3
     * reaches 143. The wide ring did not clip the cards; it walked them out
     * of the light until they went black halfway across, which reads as
     * exactly the same defect it was meant to fix.
     *
     * 4.8 keeps the ring inside the lit felt. Note what this bound is NOT
     * for: the cards that measure darkest are the ones showing their dark
     * backs mid-flip, which is the artwork doing its job. Radius turned out
     * not to predict brightness at all.
     */
    rx: Math.max(2.5, Math.min(4.8, aspect * 3.0)),
    rz: portrait ? RING_Z_PORTRAIT : RING_Z_LANDSCAPE,
    offsetZ: portrait ? OFFSET_Z_PORTRAIT : OFFSET_Z_LANDSCAPE,
  };
}

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
  /** Viewport shape, so the ring can be as wide as the frame allows. */
  private aspect = 16 / 9;

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
     *
     * Decay 1.1 rather than the physical 2, and centred over the RING's centre
     * rather than the table's: this light exists to make a ring of cards
     * evenly readable, not to model a bulb. At a realistic falloff the cards
     * nearest the middle blow out while the ones at the ends stay dark.
     */
    const glow = new PointLight('#ffe3b8', 30, 20, 1.1);
    glow.position.set(0, 4.0, -0.8);
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
    this.update(0, this.aspect);
  }

  stop(): void {
    this.running = false;
    this.root.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.cards.length = 0;
  }

  /**
   * @param dt milliseconds since the last frame.
   * @param aspect viewport width / height. Drives the ring's width; see ringX.
   */
  update(dt: number, aspect = this.aspect): void {
    this.aspect = aspect;
    if (!this.running) return;
    this.elapsed += dt / 1000;

    const n = this.cards.length;
    const orbit = (this.elapsed / ORBIT_SECONDS) * TAU;
    const { rx, rz, offsetZ } = ringShape(this.aspect);

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
        Math.cos(angle) * rx,
        REST_Y + rise * HOP_HEIGHT,
        offsetZ + Math.sin(angle) * rz,
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
