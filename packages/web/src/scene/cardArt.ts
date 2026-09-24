/**
 * The card faces, drawn to a canvas and handed to Three as a texture.
 *
 * Every measurement here was taken off the artwork embedded in Mattel's own
 * HWV18 instruction sheet rather than guessed, because the differences that
 * make a card look wrong are small and specific:
 *
 *  - the oval leans with its LONG AXIS running bottom-left to top-right, and
 *    only about 18 degrees off vertical. An earlier pass had it mirrored and
 *    lying much flatter, which was the single loudest "that isn't UNO" tell.
 *  - the oval is a thin white STROKE, not a filled shape, and it is big
 *    enough that its left and right extremes touch the card's edges.
 *  - symbols are black with a fat white keyline, drawn ACROSS the ring.
 *  - the corner marks are black-on-colour with a white keyline. Inverting
 *    that (white mark, dark keyline) is what the first attempt did, and it
 *    reads as a photo negative of the real thing.
 *
 * The sheet is monochrome, so it can only be trusted for structure. Colour
 * comes from this deck: four suits, black wilds.
 */

import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { COLORS, type Card, type CardKind, type Color } from '@uno/engine';

export const CARD_PX = { w: 320, h: 480 };

/** The deck's palette. Saturated enough to read under warm table lighting. */
export const CARD_COLORS: Record<Color, string> = {
  red: '#d7263d',
  yellow: '#f2b705',
  green: '#1ea34a',
  blue: '#1e6fd9',
};

/** Slightly darker partner for each face. The body is lit from the top right. */
const DEEP: Record<Color, string> = {
  red: '#a4132e',
  yellow: '#c68f02',
  green: '#137a36',
  blue: '#1552a6',
};

const PAPER = '#f7f4ee';
const RING = '#fcfaf6';
const INK = '#0e0e13';
/** The wild body. Kept from the existing deck: every wild reads as black. */
const WILD_BODY = '#15151d';
const WILD_DEEP = '#0a0a11';

/**
 * How far the ellipse leans, in radians, measured off the sheet.
 *
 * POSITIVE, because canvas y points down: a positive rotation tips the top of
 * a vertical axis to the RIGHT, which is the way every UNO oval leans.
 */
const TILT = 0.315;

/** Ellipse radii as fractions of the card. rx across, ry along. */
const OVAL_RX = 0.394;
const OVAL_RY = 0.437;
const RING_W = 12;

/** Kinds whose centre is a drawn picture rather than a digit. */
const PICTORIAL = new Set<CardKind>([
  'drawTwo',
  'drawFour',
  'skip',
  'reverse',
  'skipEveryone',
  'discardAll',
  'wild',
  'wildDrawFour',
  'wildDrawSix',
  'wildDrawTen',
  'wildReverseDrawFour',
  'wildColorRoulette',
]);

/** The corner text, where a card has any. Pictorial cards repeat their symbol. */
const CORNER_TEXT: Partial<Record<CardKind, string>> = {
  drawTwo: '+2',
  drawFour: '+4',
  wildDrawFour: '+4',
  wildDrawSix: '+6',
  wildDrawTen: '+10',
  wildReverseDrawFour: '+4',
};

// --- primitives -------------------------------------------------------------

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cardBase(ctx: CanvasRenderingContext2D, body: string, deep: string) {
  const { w, h } = CARD_PX;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = PAPER;
  roundRect(ctx, 0, 0, w, h, 40);
  ctx.fill();

  // Lit from the top right, the way the printed cards are shaded.
  const inset = 22;
  const g = ctx.createLinearGradient(w, 0, 0, h);
  g.addColorStop(0, body);
  g.addColorStop(1, deep);
  ctx.fillStyle = g;
  roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 26);
  ctx.fill();
}

/**
 * The scuff layer.
 *
 * Deterministic on purpose: a hash of the card's own key seeds it, so a given
 * face always scuffs the same way. Randomised grain would make two copies of
 * the same card visibly different and would break texture caching.
 */
function grain(ctx: CanvasRenderingContext2D, seed: number) {
  const { w, h } = CARD_PX;
  let s = seed || 1;
  const rnd = () => {
    // xorshift32 - small, fast, and no dependency on Math.random.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };

  ctx.save();
  roundRect(ctx, 8, 8, w - 16, h - 16, 34);
  ctx.clip();
  ctx.lineCap = 'round';

  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 13; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 22 + rnd() * 90;
    const a = rnd() * Math.PI;
    ctx.lineWidth = 0.6 + rnd() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = '#000000';
  for (let i = 0; i < 16; i++) {
    const edge = rnd() < 0.6;
    const x = edge ? (rnd() < 0.5 ? rnd() * 46 : w - rnd() * 46) : rnd() * w;
    const y = rnd() * h;
    const len = 10 + rnd() * 40;
    const a = rnd() * Math.PI;
    ctx.lineWidth = 0.7 + rnd() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** Trace the tilted ellipse without painting it. */
function ellipsePath(ctx: CanvasRenderingContext2D) {
  const { w, h } = CARD_PX;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w * OVAL_RX, h * OVAL_RY, TILT, 0, Math.PI * 2);
}

/** The ring: a thin white stroke with the body colour showing through. */
function ovalRing(ctx: CanvasRenderingContext2D) {
  ctx.save();
  // Clipped to the body so the ring stops at the card's edge rather than
  // running out over the white border, which is what the printed card does.
  const { w, h } = CARD_PX;
  roundRect(ctx, 22, 22, w - 44, h - 44, 26);
  ctx.clip();
  ellipsePath(ctx);
  ctx.lineWidth = RING_W;
  ctx.strokeStyle = RING;
  ctx.stroke();
  ctx.restore();
}

// --- the symbols ------------------------------------------------------------

/**
 * How a centre picture should be painted.
 *
 * Every symbol draws its own keylines shape by shape rather than being run
 * through one fat outline pass. A single outline around the whole picture
 * welds overlapping shapes into a blob and loses the white gaps BETWEEN the
 * cards, which on the real artwork are what let you count them.
 */
interface Paint {
  /** Fill for the shapes. */
  ink: string;
  /** The keyline drawn around each shape. */
  key: string;
  /** The card's own body colour, for shapes that knock back out of the ink. */
  body: string;
  /** Wilds give every shape its own suit. */
  tint?: (i: number) => string;
}

const SUITS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

/** The same paint with the suit tint dropped - corners are never multicoloured. */
const flat = (p: Paint): Paint => ({ ink: p.ink, key: p.key, body: p.body });
const suitTint = (i: number) => CARD_COLORS[SUITS[i % SUITS.length]!];

/** Fill a path and give it a keyline, keyline first so it sits behind. */
function shape(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  fill: string,
  key: string,
  keyW = 13,
) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path();
  ctx.lineWidth = keyW;
  ctx.strokeStyle = key;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/** A stroked path with a keyline underneath it. */
function inkedStroke(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  lw: number,
  fill: string,
  key: string,
  keyW = 13,
) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path();
  ctx.lineWidth = lw + keyW * 2;
  ctx.strokeStyle = key;
  ctx.stroke();
  path();
  ctx.lineWidth = lw;
  ctx.strokeStyle = fill;
  ctx.stroke();
  ctx.restore();
}

/** Layouts for the draw-card families, in card-space px around the centre. */
type Slot = [x: number, y: number, w: number, h: number, rot: number];

/** Two cards, offset on the diagonal. The +2 picture. */
const TWO: Slot[] = [
  [-34, 30, 84, 96, -0.07],
  [30, -26, 84, 96, 0.06],
];

/** Four cards climbing to the right. The +4 picture, straight off the sheet. */
const FOUR: Slot[] = [
  [-52, 44, 62, 90, -0.04],
  [-14, 14, 62, 90, 0.02],
  [22, -12, 62, 90, -0.02],
  [56, -44, 62, 90, 0.05],
];

/** Six cards in a loose cluster. */
const SIX: Slot[] = [
  [-52, 36, 60, 78, -0.09],
  [4, 50, 66, 78, 0.05],
  [-58, -30, 60, 78, 0.06],
  [0, -14, 60, 78, -0.04],
  [54, 20, 60, 78, 0.08],
  [46, -46, 60, 78, -0.06],
];

/** Ten cards, tighter and smaller - the pile you do not want. */
const TEN: Slot[] = [
  [-58, 54, 50, 66, -0.10],
  [-6, 66, 50, 66, 0.04],
  [44, 46, 50, 66, 0.09],
  [-64, -2, 50, 66, 0.05],
  [-14, 12, 50, 66, -0.03],
  [38, -6, 50, 66, 0.07],
  [-52, -56, 50, 66, -0.06],
  [-2, -46, 50, 66, 0.03],
  [50, -56, 50, 66, -0.08],
  [16, -100, 50, 66, 0.02],
];

/** Four cards in a diamond, for the Wild Reverse Draw 4 to sit over. */
const REV_FOUR: Slot[] = [
  [-52, 44, 70, 92, -0.05],
  [52, -44, 70, 92, 0.05],
  [-46, -34, 70, 92, 0.04],
  [46, 36, 70, 92, -0.04],
];

function cardCluster(ctx: CanvasRenderingContext2D, slots: Slot[], paint: Paint) {
  slots.forEach(([x, y, w, h, rot], i) => {
    const fill = paint.tint ? paint.tint(i) : paint.ink;
    shape(
      ctx,
      () => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.2);
        ctx.restore();
      },
      fill,
      paint.key,
      14,
    );
  });
}

/**
 * Skip: a thick black annulus with a bar cut across it.
 *
 * The bar is the BODY colour, not the ink. On the printed card the slash is a
 * gap through the ring rather than a second black stroke, and drawing it in
 * ink gives you a solid black lozenge instead of a "no entry" sign.
 */
function circleSlash(ctx: CanvasRenderingContext2D, r: number, paint: Paint) {
  const lw = r * 0.40;
  inkedStroke(ctx, () => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }, lw, paint.ink, paint.key, 12);

  const reach = r * 1.16;
  ctx.save();
  ctx.rotate(-0.38);
  inkedStroke(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-reach, 0);
    ctx.lineTo(reach, 0);
  }, lw * 0.48, paint.body, paint.key, 8);
  ctx.restore();
}

/**
 * One arrow of the Reverse pair: a shaft with a head, and a tail that hooks
 * across the centreline so the two of them interlock into an S.
 */
function hookArrow(ctx: CanvasRenderingContext2D, s: number, paint: Paint) {
  const lw = s * 0.22;

  inkedStroke(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-0.80 * s, -0.24 * s); // the tail kicks back across the pair
    ctx.lineTo(-0.48 * s, 0);
    ctx.lineTo(0.28 * s, 0);
  }, lw, paint.ink, paint.key, 11);

  const hw = 0.28 * s;
  shape(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0.88 * s, 0);
    ctx.lineTo(0.24 * s, -hw);
    ctx.lineTo(0.24 * s, hw);
    ctx.closePath();
  }, paint.ink, paint.key, 11);
}

/**
 * Reverse: two arrows lying on the up-right diagonal, pointing opposite ways.
 *
 * Single-headed. A double-headed arrow is a different card entirely, and the
 * offset between the two has to be PERPENDICULAR to their shared axis -
 * offsetting along it slides them onto each other into one thick squiggle.
 */
function reverseGlyph(ctx: CanvasRenderingContext2D, s: number, paint: Paint) {
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.translate(0, -0.23 * s);
    hookArrow(ctx, s, paint);
    ctx.restore();
    ctx.rotate(Math.PI);
  }
  ctx.restore();
}

/**
 * Skip Everyone: one arrow that goes all the way round.
 *
 * ONE head. The picture is "the turn travels past every player and comes back
 * to you", and a second head at the tail turns that into an ordinary
 * two-way arrow, which is a different card.
 */
function circularArrow(ctx: CanvasRenderingContext2D, r: number, paint: Paint) {
  const lw = r * 0.34;
  const a0 = Math.PI * 0.42;
  const a1 = Math.PI * 2.16;

  inkedStroke(ctx, () => {
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
  }, lw, paint.ink, paint.key, 12);

  // The head straddles the stroke and points along the tangent, built from
  // the tangent and the radius rather than from angles off the tip.
  const ax = Math.cos(a1) * r;
  const ay = Math.sin(a1) * r;
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  const nx = Math.cos(a1);
  const ny = Math.sin(a1);
  const half = lw * 1.25;
  const reach = lw * 2.0;
  const back = lw * 0.55; // overlap the arc so the head is part of the stroke
  shape(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(ax + tx * reach, ay + ty * reach);
    ctx.lineTo(ax - tx * back + nx * half, ay - ty * back + ny * half);
    ctx.lineTo(ax - tx * back - nx * half, ay - ty * back - ny * half);
    ctx.closePath();
  }, paint.ink, paint.key, 11);
}

/** Discard All: a fan of cards thrown down onto a pile. */
function fanToPile(ctx: CanvasRenderingContext2D, s: number, paint: Paint) {
  ctx.save();
  ctx.scale(s, s);

  // The fan, upper right. Each card pivots about a point BELOW itself, the
  // way a hand actually fans; rotating about their own centres stacks them
  // all on one spot.
  ctx.save();
  ctx.translate(22, -58);
  ctx.rotate(-0.08);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate(-0.44 + i * 0.22);
    ctx.translate(0, -56);
    shape(ctx, () => roundRect(ctx, -20, -50, 40, 100, 8), paint.ink, paint.key, 11);
    ctx.restore();
  }
  ctx.restore();

  // The pile they land on, lower left: a slab with the stack ruled under it.
  ctx.save();
  ctx.translate(-52, 70);
  ctx.rotate(-0.04);
  shape(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-40, -22);
    ctx.lineTo(48, -22);
    ctx.lineTo(40, 20);
    ctx.lineTo(-48, 20);
    ctx.closePath();
  }, paint.ink, paint.key, 11);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = paint.key;
    ctx.beginPath();
    ctx.moveTo(-48 - i * 0.5, 26 + i * 11);
    ctx.lineTo(40 - i * 0.5, 26 + i * 11);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = paint.ink;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // The curved arrow from one to the other, drawn in the keyline colour the
  // way the sheet does - it is the one white element in a black picture.
  ctx.save();
  inkedStroke(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(52, 4);
    ctx.quadraticCurveTo(38, 44, -4, 46);
  }, 13, paint.key, paint.ink, 5);
  shape(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-26, 52);
    ctx.lineTo(0, 26);
    ctx.lineTo(6, 58);
    ctx.closePath();
  }, paint.key, paint.ink, 5);
  ctx.restore();

  ctx.restore();
}

/**
 * Wild Color Roulette: four unhappy faces, one per suit.
 *
 * Four, not three. The card is "someone is about to draw until they find a
 * colour" and the artwork shows the whole table wearing it.
 */
function sadFaces(ctx: CanvasRenderingContext2D, s: number, paint: Paint) {
  const set: [number, number, number, number][] = [
    [2, -58, 1.02, 0.03],
    [-56, 12, 1.0, -0.10],
    [56, 6, 1.0, 0.09],
    [0, 66, 1.06, -0.02],
  ];

  ctx.save();
  ctx.scale(s, s);
  set.forEach(([x, y, sc, rot], i) => {
    const fill = paint.tint ? paint.tint(i) : paint.ink;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);

    // A rounded tile with a scalloped bottom edge - the sheet's little
    // hangdog mask. The scallop is what stops it reading as a blank tile.
    shape(ctx, () => {
      const w = 46;
      const t = -40;
      const b = 30;
      ctx.beginPath();
      ctx.moveTo(-w + 12, t);
      ctx.arcTo(w, t, w, b, 12);
      ctx.lineTo(w, b);
      for (let k = 0; k < 3; k++) {
        const x0 = w - (k * 2 * w) / 3;
        const x1 = w - ((k + 1) * 2 * w) / 3;
        ctx.quadraticCurveTo((x0 + x1) / 2, b + 28, x1, b);
      }
      ctx.lineTo(-w, t + 12);
      ctx.arcTo(-w, t, w, t, 12);
      ctx.closePath();
    }, fill, paint.key, 12);

    // Features knocked back out in the body colour.
    ctx.fillStyle = paint.body;
    ctx.strokeStyle = paint.body;
    ctx.beginPath();
    ctx.arc(-15, -10, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(15, -10, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 30, 18, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}

// --- assembling a centre ----------------------------------------------------

function centrePicture(ctx: CanvasRenderingContext2D, kind: CardKind, paint: Paint) {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.translate(w / 2, h / 2);

  switch (kind) {
    case 'drawTwo':
      cardCluster(ctx, TWO, paint);
      break;
    case 'drawFour':
    case 'wildDrawFour':
      cardCluster(ctx, FOUR, paint);
      break;
    case 'wildDrawSix':
      cardCluster(ctx, SIX, paint);
      break;
    case 'wildDrawTen':
      cardCluster(ctx, TEN, paint);
      break;
    case 'skip':
      circleSlash(ctx, 96, paint);
      break;
    case 'reverse':
      reverseGlyph(ctx, 112, paint);
      break;
    case 'skipEveryone':
      circularArrow(ctx, 92, paint);
      break;
    case 'discardAll':
      fanToPile(ctx, 1.06, paint);
      break;
    case 'wildReverseDrawFour':
      cardCluster(ctx, REV_FOUR, paint);
      reverseGlyph(ctx, 88, paint.tint ? { ink: INK, key: RING, body: paint.body } : flat(paint));
      break;
    case 'wildColorRoulette':
      sadFaces(ctx, 1.12, paint);
      break;
    case 'wild':
      cardCluster(ctx, TWO, paint);
      break;
    default:
      break;
  }
  ctx.restore();
}

// --- text -------------------------------------------------------------------

function centreDigit(ctx: CanvasRenderingContext2D, text: string) {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(TILT * 0.22);
  ctx.font = `800 ${text.length > 1 ? 168 : 236}px Archivo, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 30;
  ctx.strokeStyle = RING;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = INK;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * The little glyph a 0 or a 7 carries under its corner digit.
 *
 * Straight off the artwork, and a detail worth keeping: the card tells you it
 * moves hands around before you have read any rules.
 */
function handMoveGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'rotate' | 'swap',
  ink: string,
  key: string,
) {
  const draw = (color: string, lw: number, headScale: number) => {
    ctx.save();
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (kind === 'rotate') {
      ctx.beginPath();
      ctx.arc(0, 0, 11, -Math.PI * 0.55, Math.PI * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, -15 * headScale);
      ctx.lineTo(15 * headScale, -8);
      ctx.lineTo(3, -1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 19 * headScale, 0);
        ctx.lineTo(s * 8, -7);
        ctx.lineTo(s * 8, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  draw(key, 11, 1);
  draw(ink, 5, 1);
}

/**
 * One corner mark, at the current origin.
 *
 * Black mark, white keyline, on a coloured card - the same way round as the
 * middle of the card. Wilds flip it, because a black mark on a black body is
 * an invisible mark.
 */
function cornerMark(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  rank: number | undefined,
  paint: Paint,
) {
  const text = kind === 'number' ? String(rank) : CORNER_TEXT[kind];

  if (text) {
    ctx.save();
    ctx.font = `800 ${text.length > 2 ? 48 : 62}px Archivo, Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = paint.key;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = paint.ink;
    ctx.fillText(text, 0, 0);
    ctx.restore();

    if (kind === 'number' && (rank === 0 || rank === 7)) {
      ctx.save();
      ctx.translate(0, 45);
      handMoveGlyph(ctx, rank === 0 ? 'rotate' : 'swap', paint.ink, paint.key);
      ctx.restore();
    }
    if (kind === 'wildReverseDrawFour') {
      ctx.save();
      ctx.translate(-54, -2);
      reverseGlyph(ctx, 22, flat(paint));
      ctx.restore();
    }
    return;
  }

  // Discard All's corner is just the fan. Shrinking the whole three-part
  // picture to a quarter size turns it into debris.
  if (kind === 'discardAll') {
    ctx.save();
    ctx.scale(0.3, 0.3);
    ctx.rotate(-0.1);
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate(-0.44 + i * 0.22);
      ctx.translate(0, -56);
      shape(ctx, () => roundRect(ctx, -20, -50, 40, 100, 8), paint.ink, paint.key, 11);
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  // Other pictorial kinds repeat their own symbol, small.
  ctx.save();
  ctx.scale(0.25, 0.25);
  ctx.translate(-CARD_PX.w / 2, -CARD_PX.h / 2);
  centrePicture(ctx, kind, flat(paint));
  ctx.restore();
}

/** Both corners: upright top-left, rotated 180 at bottom-right. */
function corners(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  rank: number | undefined,
  paint: Paint,
) {
  const { w, h } = CARD_PX;
  for (const [x, y, rot] of [
    [72, 76, 0],
    [w - 72, h - 76, Math.PI],
  ] as [number, number, number][]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    cornerMark(ctx, kind, rank, paint);
    ctx.restore();
  }
}

// --- faces ------------------------------------------------------------------

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  color: Color | undefined,
  rank: number | undefined,
  seed: number,
) {
  if (!color) {
    /*
     * Wilds keep this deck's own colour identity - a black card - and take
     * Mattel's structure: the same white ring a coloured card has, with the
     * picture inside drawn in all four suits, one shape per suit. That is the
     * card saying "any colour" without needing a wheel.
     *
     * The sheet prints wilds light-on-dark, but the sheet is a one-colour
     * leaflet and the physical deck's wilds are black, so the ground stays
     * black and the corner marks flip to white.
     */
    cardBase(ctx, WILD_BODY, WILD_DEEP);
    ovalRing(ctx);
    centrePicture(ctx, kind, {
      ink: RING,
      key: RING,
      body: WILD_BODY,
      tint: suitTint,
    });
    corners(ctx, kind, rank, { ink: RING, key: INK, body: WILD_BODY });
    grain(ctx, seed);
    return;
  }

  const body = CARD_COLORS[color];
  cardBase(ctx, body, DEEP[color]);
  ovalRing(ctx);

  const paint: Paint = { ink: INK, key: RING, body };
  if (PICTORIAL.has(kind)) {
    centrePicture(ctx, kind, paint);
  } else {
    centreDigit(ctx, kind === 'number' ? String(rank) : '');
  }

  corners(ctx, kind, rank, paint);
  grain(ctx, seed);
}

/** The shared back design: dark body, tilted ring, UNO wordmark. */
function drawBack(ctx: CanvasRenderingContext2D) {
  const { w, h } = CARD_PX;
  cardBase(ctx, '#171722', '#0b0b12');

  ctx.save();
  roundRect(ctx, 22, 22, w - 44, h - 44, 26);
  ctx.clip();
  ellipsePath(ctx);
  ctx.fillStyle = CARD_COLORS.red;
  ctx.fill();
  ctx.lineWidth = RING_W;
  ctx.strokeStyle = RING;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(TILT);
  ctx.font = `800 104px "Bricolage Grotesque", Archivo, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#171722';
  ctx.strokeText('UNO', 0, 0);
  ctx.fillStyle = RING;
  ctx.fillText('UNO', 0, 0);
  ctx.restore();

  grain(ctx, 0x5eed);
}

// --- plumbing ---------------------------------------------------------------

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_PX.w;
  canvas.height = CARD_PX.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable — cannot draw card faces');
  return ctx;
}

function toTexture(ctx: CanvasRenderingContext2D): Texture {
  const tex = new CanvasTexture(ctx.canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A card's identity for art purposes: colour + kind + rank. */
export function faceKey(card: Card): string {
  return card.kind === 'number'
    ? `${card.color}-n${card.rank}`
    : `${card.color ?? 'wild'}-${card.kind}`;
}

const cache = new Map<string, Texture>();
let backTexture: Texture | null = null;

export function faceTexture(card: Card): Texture {
  const key = faceKey(card);
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = makeCanvas();
  drawFace(ctx, card.kind, card.color, card.rank, hashKey(key));
  const tex = toTexture(ctx);
  cache.set(key, tex);
  return tex;
}

export function backFaceTexture(): Texture {
  if (backTexture) return backTexture;
  const ctx = makeCanvas();
  drawBack(ctx);
  backTexture = toTexture(ctx);
  return backTexture;
}

/**
 * Pre-draw every face the deck can contain.
 *
 * Done once during the loading screen so the first deal does not stutter
 * while seventy canvases are rasterised mid-animation.
 */
export function warmCardArt(): number {
  const kinds: CardKind[] = [
    'drawTwo',
    'skip',
    'reverse',
    'drawFour',
    'skipEveryone',
    'discardAll',
  ];
  let n = 0;
  for (const color of COLORS) {
    for (let rank = 0; rank <= 9; rank++) {
      faceTexture({ id: '', kind: 'number', color, rank });
      n++;
    }
    for (const kind of kinds) {
      faceTexture({ id: '', kind, color });
      n++;
    }
  }
  for (const kind of [
    'wild',
    'wildDrawFour',
    'wildDrawSix',
    'wildDrawTen',
    'wildReverseDrawFour',
    'wildColorRoulette',
  ] as CardKind[]) {
    faceTexture({ id: '', kind });
    n++;
  }
  backFaceTexture();
  return n;
}
