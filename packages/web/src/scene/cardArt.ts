/**
 * Card artwork.
 *
 * Every face is drawn to a canvas at load time and handed to Three as a
 * texture. Drawing rather than shipping images means no binary assets, no
 * atlas packing, and the art scales to whatever resolution we ask for.
 *
 * Only ~70 faces are unique (10 ranks x 4 colours, 6 action kinds x 4 colours,
 * 6 wild kinds), so faces are cached by key and shared across the 168 physical
 * cards that reference them.
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

/** Slightly darker partner for each face, used for the oval and shading. */
const DEEP: Record<Color, string> = {
  red: '#9e1129',
  yellow: '#c08c00',
  green: '#137534',
  blue: '#14509e',
};

const CARD_WHITE = '#f7f4ee';
const WILD_BODY = '#161620';

/**
 * Centre label for kinds that are drawn as TEXT. Numbers use their digit.
 *
 * Kinds with a drawn icon (skip, reverse, skip-everyone, discard-all) are
 * absent here and handled by drawIcon() instead - real UNO uses symbols, not
 * words, and "SKIP" spelled out reads as a placeholder.
 */
const GLYPH: Partial<Record<CardKind, string>> = {
  drawTwo: '+2',
  drawFour: '+4',
  wild: 'WILD',
  wildDrawFour: '+4',
  wildDrawSix: '+6',
  wildDrawTen: '+10',
  wildReverseDrawFour: '+4',
  wildColorRoulette: '?',
};

/** Kinds whose centre is an icon rather than a label. */
const ICON_KINDS = new Set<CardKind>(['skip', 'reverse', 'skipEveryone', 'discardAll']);

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

/** The white border every UNO card has, plus the coloured body inside it. */
function cardBase(ctx: CanvasRenderingContext2D, body: string) {
  const { w, h } = CARD_PX;
  ctx.clearRect(0, 0, w, h);

  // White frame.
  ctx.fillStyle = CARD_WHITE;
  roundRect(ctx, 0, 0, w, h, 40);
  ctx.fill();

  // Coloured body.
  const inset = 22;
  ctx.fillStyle = body;
  roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 26);
  ctx.fill();
}

/** The signature tilted white oval through the middle of the card. */
function oval(ctx: CanvasRenderingContext2D, fill = CARD_WHITE, alpha = 1) {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 5);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.40, h * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function centreText(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  outline: string | null,
) {
  const { w, h } = CARD_PX;
  // Long labels have to shrink or they run off the oval.
  const size = text.length >= 4 ? 96 : text.length === 3 ? 122 : text.length === 2 ? 156 : 210;
  ctx.font = `800 ${size}px Archivo, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 24);
  if (outline) {
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** How much of the full-size icon fits in a corner. */
const CORNER_SCALE = 0.3;

/**
 * One corner mark, centred on the current origin.
 *
 * Icon cards get a miniature of their own symbol; only cards whose CENTRE is
 * text get text here. That is the rule on a real card and it is what makes a
 * fanned hand readable - you recognise the shape, not a two-letter code.
 */
function cornerMark(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  rank: number | undefined,
  color: string,
): void {
  if (kind !== 'number' && ICON_KINDS.has(kind)) {
    drawIcon(ctx, kind, color, 'transparent', { x: 0, y: 0, scale: CORNER_SCALE });
    return;
  }

  if (kind === 'wildColorRoulette') {
    // A wheel, not a question mark: the wheel is what the card is about.
    colorWheel(ctx, 0, 0, 30);
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    return;
  }

  if (kind === 'wildReverseDrawFour') {
    // The two things it does, stacked: reverse above, +4 below.
    drawIcon(ctx, 'reverse', color, 'transparent', { x: 0, y: -30, scale: 0.16 });
    cornerText(ctx, '+4', color, 0, 26);
    return;
  }

  const text = kind === 'number' ? String(rank) : (GLYPH[kind] ?? '');
  cornerText(ctx, text, color, 0, 0);
}

function cornerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  x: number,
  y: number,
): void {
  const size = text.length >= 3 ? 40 : 54;
  ctx.font = `700 ${size}px Archivo, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** centreText, but at a chosen height and size - used when a face stacks two marks. */
function centreTextAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  outline: string | null,
  y: number,
  size: number,
): void {
  const { w } = CARD_PX;
  ctx.font = `800 ${size}px Archivo, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(w / 2, y);
  ctx.rotate(-Math.PI / 24);
  if (outline) {
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function corners(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  rank: number | undefined,
  color: string,
): void {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.translate(74, 74);
  cornerMark(ctx, kind, rank, color);
  ctx.restore();

  // Bottom-right is the same mark rotated 180, exactly like a real card.
  ctx.save();
  ctx.translate(w - 74, h - 74);
  ctx.rotate(Math.PI);
  cornerMark(ctx, kind, rank, color);
  ctx.restore();
}

/** The four-colour wheel used on wild cards. */
function colorWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const order: Color[] = ['red', 'blue', 'yellow', 'green'];
  order.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, (i * Math.PI) / 2 - Math.PI / 2, ((i + 1) * Math.PI) / 2 - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = CARD_COLORS[c];
    ctx.fill();
  });
}

/**
 * Fill the signature tilted oval with the four colours.
 *
 * The earlier version drew a wheel and then dropped a 55%-black disc on top of
 * it, which made every wild card look muddy and put the number on almost no
 * contrast. Filling the oval itself keeps the "this card is colourless" signal
 * loud and leaves a bright ground for the label to sit on.
 */
function wildOval(ctx: CanvasRenderingContext2D) {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 5);

  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.40, h * 0.30, 0, 0, Math.PI * 2);
  ctx.clip();

  // Quadrants, drawn generously so they cover the whole clipped ellipse.
  const R = h;
  const order: Color[] = ['red', 'blue', 'green', 'yellow'];
  order.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = CARD_COLORS[c];
    ctx.fill();
  });
  ctx.restore();

  // A white keyline separates the oval from the black body.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 5);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.40, h * 0.30, 0, 0, Math.PI * 2);
  ctx.lineWidth = 9;
  ctx.strokeStyle = CARD_WHITE;
  ctx.stroke();
  ctx.restore();
}

/**
 * Action-card icons, drawn as vectors.
 *
 * `stroke` is the ink colour (the card's own colour on a coloured card, white
 * on a wild) and `shadow` is the contrasting outline behind it.
 */
/**
 * @param at where to draw and how big. Defaults to full size at card centre;
 *   the corners pass a small scale so a corner shows the SAME symbol as the
 *   middle, which is how a real card works. The corners used to carry letter
 *   codes instead - "OO" for Skip Everyone, "D" for Discard All - which read
 *   as typos rather than as marks meaning anything.
 */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  kind: CardKind,
  stroke: string,
  shadow: string,
  at?: { x: number; y: number; scale: number },
): void {
  const { w, h } = CARD_PX;
  ctx.save();
  ctx.translate(at?.x ?? w / 2, at?.y ?? h / 2);
  if (at) ctx.scale(at.scale, at.scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ring = (r: number, lw: number) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  const slash = (r: number, lw: number) => {
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, r * 0.72);
    ctx.lineTo(r * 0.72, -r * 0.72);
    ctx.lineWidth = lw;
    ctx.stroke();
  };

  // Draw each icon twice: a thick shadow pass, then the ink pass on top.
  const passes: [string, number][] = [
    [shadow, 1],
    [stroke, 0],
  ];

  if (kind === 'skip' || kind === 'skipEveryone') {
    /*
     * Skip is one circle-slash. Skip Everyone is THREE of them in a row -
     * one per player it takes out.
     *
     * It was two, overlapping, which merged into a single pretzel shape that
     * read as neither "skip" nor "everyone". Separated marks stay countable
     * at the size a card actually gets drawn.
     */
    const offs = kind === 'skipEveryone' ? [-74, 0, 74] : [0];
    const r = kind === 'skipEveryone' ? 36 : 86;
    // Stroke weight has to follow the radius. Fixed at 20px it was as thick
    // as a Skip Everyone ring is wide, and the three marks filled in solid.
    const lw = r * 0.23;
    for (const [color, extra] of passes) {
      ctx.strokeStyle = color;
      for (const dx of offs) {
        ctx.save();
        ctx.translate(dx, 0);
        ring(r, lw + extra * r * 0.16);
        slash(r, lw + extra * r * 0.16);
        ctx.restore();
      }
    }
  } else if (kind === 'reverse') {
    /**
     * Two parallel arrows pointing opposite ways - the classic reverse mark.
     *
     * An earlier attempt bent each arrow round a corner and the two shapes
     * overlapped into an unreadable blob at card size. Straight, separated
     * arrows survive being 60px tall on a tilted card.
     */
    const arrow = (x: number, dir: number, lw: number, fill: string) => {
      ctx.strokeStyle = fill;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x, 58 * dir);
      ctx.lineTo(x, -18 * dir);
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 32, -16 * dir);
      ctx.lineTo(x + 32, -16 * dir);
      ctx.lineTo(x, -70 * dir);
      ctx.closePath();
      ctx.fill();
    };
    for (const [color, extra] of passes) {
      ctx.save();
      ctx.rotate(-0.18);
      arrow(-38, 1, 22 + extra * 14, color);
      arrow(38, -1, 22 + extra * 14, color);
      ctx.restore();
    }
  } else if (kind === 'discardAll') {
    /**
     * A fanned stack of cards being thrown down: dump every card of this
     * colour at once.
     *
     * Each card is filled with the ink colour and separated by a WHITE
     * keyline. Outlining them in the shadow colour instead merged the three
     * into one solid block, because the outline and the fill were the same
     * dark tone.
     */
    ctx.save();
    ctx.rotate(-0.12);
    for (let i = 2; i >= 0; i--) {
      ctx.beginPath();
      ctx.roundRect(-96 + i * 40, -62 + i * 9, 58, 96, 10);
      ctx.fillStyle = stroke;
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = CARD_WHITE;
      ctx.stroke();
    }
    ctx.restore();

    // A down arrow clear of the stack, so it is not lost against the cards.
    ctx.save();
    ctx.translate(92, 4);
    ctx.beginPath();
    ctx.moveTo(0, -64);
    ctx.lineTo(0, 6);
    ctx.lineWidth = 26;
    ctx.strokeStyle = CARD_WHITE;
    ctx.stroke();
    ctx.lineWidth = 16;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    const head = (scale: number, fill: string) => {
      ctx.beginPath();
      ctx.moveTo(-34 * scale, -4);
      ctx.lineTo(34 * scale, -4);
      ctx.lineTo(0, 44 * scale + 18);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    head(1.22, CARD_WHITE);
    head(1, stroke);
    ctx.restore();
  }

  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, kind: CardKind, color: Color | undefined, rank?: number) {
  const isWild = !color;

  if (isWild) {
    cardBase(ctx, WILD_BODY);
    const { w, h } = CARD_PX;

    if (kind === 'wild') {
      // A plain Wild is the wheel itself, big and clean.
      colorWheel(ctx, w / 2, h / 2, w * 0.32);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.32, 0, Math.PI * 2);
      ctx.lineWidth = 9;
      ctx.strokeStyle = CARD_WHITE;
      ctx.stroke();
      corners(ctx, kind, rank, CARD_WHITE);
      return;
    }

    // Every other wild: colour-filled oval with a heavily outlined label, so
    // "+10" reads from across the table at any card angle.
    wildOval(ctx);
    if (kind === 'wildReverseDrawFour') {
      /*
       * This card both reverses and hits for 4, and drawn as a bare "+4" it
       * was indistinguishable from the coloured +4 - two very different cards
       * with the same face. Show both jobs: arrows above, penalty below.
       */
      drawIcon(ctx, 'reverse', CARD_WHITE, '#101018', { x: w / 2, y: h * 0.41, scale: 0.42 });
      centreTextAt(ctx, '+4', CARD_WHITE, '#101018', h * 0.605, 94);
    } else if (ICON_KINDS.has(kind)) {
      drawIcon(ctx, kind, CARD_WHITE, '#101018');
    } else {
      centreText(ctx, GLYPH[kind] ?? '', CARD_WHITE, '#101018');
    }
    corners(ctx, kind, rank, CARD_WHITE);
    return;
  }

  cardBase(ctx, CARD_COLORS[color]);
  oval(ctx);
  if (ICON_KINDS.has(kind)) {
    drawIcon(ctx, kind, CARD_COLORS[color], DEEP[color]);
  } else {
    const label = kind === 'number' ? String(rank) : (GLYPH[kind] ?? '');
    centreText(ctx, label, CARD_COLORS[color], DEEP[color]);
  }
  corners(ctx, kind, rank, CARD_WHITE);
}

/** The shared back design: dark body, tilted oval, UNO wordmark. */
function drawBack(ctx: CanvasRenderingContext2D) {
  const { w, h } = CARD_PX;
  cardBase(ctx, '#15151f');
  oval(ctx, '#d7263d');
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 5);
  ctx.font = `800 104px "Bricolage Grotesque", Archivo, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 11;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#15151f';
  ctx.strokeText('UNO', 0, 0);
  ctx.fillStyle = CARD_WHITE;
  ctx.fillText('UNO', 0, 0);
  ctx.restore();
}

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
  return card.kind === 'number' ? `${card.color}-n${card.rank}` : `${card.color ?? 'wild'}-${card.kind}`;
}

const cache = new Map<string, Texture>();
let backTexture: Texture | null = null;

export function faceTexture(card: Card): Texture {
  const key = faceKey(card);
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = makeCanvas();
  drawFace(ctx, card.kind, card.color, card.rank);
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
