/**
 * Grounds: the whole colour identity of the game, in one place.
 *
 * WHY THIS FILE EXISTS
 *
 * The palette was not muddy by accident. Measured on the colour wheel, the
 * UI accent (#c9a227, hue 46) and the yellow card (#f2b705, hue 45) were the
 * SAME COLOUR one degree apart, and the danger red sat 15 degrees off the red
 * card. So every "this is live, this is your turn, this matters" mark on
 * screen was painted in a colour the game already uses to mean "this card is
 * yellow" - the chrome and the content were arguing over the same hues.
 *
 * A four-suit card game has already spent most of the wheel before the
 * interface gets a say. Claiming 30 degrees either side of each card hue
 * leaves three usable arcs - 35 degrees at lime, 14 at cyan, and 78 between
 * blue and red - and overruns the orange gap outright at minus seven. So
 * there are exactly two legal moves for an accent, and every ground here
 * takes one of them:
 *
 *     chroma < 10%     (the hue cannot register)
 *   OR nearest card hue > 55 degrees
 *
 * Add a ground only if it passes that test. The check is one line of
 * arithmetic and it is the difference between a palette that reads and one
 * that argues with itself.
 *
 * WHAT A GROUND IS
 *
 * The CSS half lives in styles.css under [data-ground="..."]; this file is
 * the 3D half, because the room behind the chrome has to agree with it. Two
 * rooms serve three grounds: a light paper chrome over a green card table is
 * a perfectly good pairing, so Newsprint borrows Baize's room.
 */

/** The 3D room: felt, furniture and the lamp over it. */
export interface Room {
  /** Beyond the lamp's reach. Also the fog colour, so the room has no walls. */
  pitch: string;
  /** The playing surface. */
  felt: string;
  /** The padded rim, and the shadow under it. */
  rim: string;
  rimUnder: string;
  /** The bulb. */
  lamp: string;
  /** A short-range fill at the centre, so the discard is never in the dark. */
  centre: string;
  /** Evens out the near edge, so the hand is lit flat and only tint varies. */
  nearEdge: string;
  /** Bounce off the floor, from behind the camera. */
  floor: string;
  ambient: string;
  hemiSky: string;
  hemiGround: string;
}

/**
 * Worn baize under a tungsten bulb.
 *
 * The original Back Room values, unchanged. Under this light the green reads
 * closer to olive than emerald, which is the intention.
 */
const WARM_ROOM: Room = {
  pitch: '#0a0907',
  felt: '#16271e',
  rim: '#2b1a12',
  rimUnder: '#180e0a',
  lamp: '#ffdfb4',
  centre: '#ffdca8',
  nearEdge: '#ffeedc',
  floor: '#c9b094',
  ambient: '#2e2418',
  hemiSky: '#4a3a22',
  hemiGround: '#0a0f0b',
};

/**
 * The same room with the colour taken out of the light.
 *
 * Not "grey": a neutral bulb still has to look like a bulb, so the lamp keeps
 * the faintest warmth and everything it falls on is achromatic. The felt goes
 * to a dark neutral so that all four suits sit on the same ground - on green
 * baize a green card is the one card that never quite separates.
 */
const NEUTRAL_ROOM: Room = {
  pitch: '#0a0a0b',
  felt: '#1c1d1e',
  rim: '#232324',
  rimUnder: '#121213',
  lamp: '#fff6ec',
  centre: '#fff3e6',
  nearEdge: '#fffaf4',
  floor: '#b9b6b1',
  ambient: '#232324',
  hemiSky: '#3a3a3c',
  hemiGround: '#0c0c0d',
};

export type GroundId = 'house' | 'baize' | 'newsprint';

export interface Ground {
  id: GroundId;
  /** For the ground switcher and for saying which one is on screen. */
  label: string;
  room: Room;
}

export const GROUNDS: Record<GroundId, Ground> = {
  /** No hue anywhere in the chrome. The cards are the only colour in the room. */
  house: { id: 'house', label: 'House', room: NEUTRAL_ROOM },
  /** The room as chosen, with the gold that collided with the yellow card removed. */
  baize: { id: 'baize', label: 'Baize', room: WARM_ROOM },
  /** Paper chrome over a real card table. */
  newsprint: { id: 'newsprint', label: 'Newsprint', room: WARM_ROOM },
};

/**
 * The ground the game ships with.
 *
 * Changing this one word changes the whole game: the CSS reads it off the
 * root element, the 3D room reads it off the export below.
 */
export const DEFAULT_GROUND: GroundId = 'baize';

const isGround = (v: string | null): v is GroundId =>
  v === 'house' || v === 'baize' || v === 'newsprint';

/**
 * Which ground to run.
 *
 * Honours ?ground= in dev builds only, so the three can be compared in the
 * real game rather than in a mock-up. In production it is always the default:
 * a shipped game should not have its identity changed by a query string.
 */
export function activeGround(): Ground {
  if (import.meta.env.DEV) {
    const asked = new URLSearchParams(window.location.search).get('ground');
    if (isGround(asked)) return GROUNDS[asked];
  }
  return GROUNDS[DEFAULT_GROUND];
}

/** Stamp the ground on the root element, which is what the CSS keys off. */
export function applyGround(ground: Ground): void {
  document.documentElement.dataset.ground = ground.id;
}
