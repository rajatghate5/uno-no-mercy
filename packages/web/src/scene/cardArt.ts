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

/** Big centre symbol for each kind. Numbers use their digit instead. */
const GLYPH: Partial<Record<CardKind, string>> = {
  drawTwo: '+2',
  drawFour: '+4',
  skip: 'SKIP',
  reverse: 'REV',
  skipEveryone: 'ALL',
  discardAll: 'DUMP',
  wild: 'WILD',
  wildDrawFour: '+4',
  wildDrawSix: '+6',
  wildDrawTen: '+10',
  wildReverseDrawFour: '+4',
  wildColorRoulette: '?',
};

/** Small corner mark. Shorter than the centre glyph so it fits. */
const CORNER: Partial<Record<CardKind, string>> = {
  drawTwo: '+2',
  drawFour: '+4',
  skip: 'S',
  reverse: 'R',
  skipEveryone: 'SA',
  discardAll: 'DA',
  wild: 'W',
  wildDrawFour: '+4',
  wildDrawSix: '+6',
  wildDrawTen: '+10',
  wildReverseDrawFour: 'R4',
  wildColorRoulette: '?',
};

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

function corners(ctx: CanvasRenderingContext2D, text: string, color: string) {
  const { w, h } = CARD_PX;
  const size = text.length >= 3 ? 40 : 54;
  ctx.font = `700 ${size}px Archivo, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 44, 40);
  // Bottom-right is the same mark rotated 180, exactly like a real card.
  ctx.save();
  ctx.translate(w - 44, h - 40);
  ctx.rotate(Math.PI);
  ctx.fillText(text, 0, 0);
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

function drawFace(ctx: CanvasRenderingContext2D, kind: CardKind, color: Color | undefined, rank?: number) {
  const isWild = !color;

  if (isWild) {
    cardBase(ctx, WILD_BODY);
    const { w, h } = CARD_PX;

    if (kind === 'wild') {
      // A plain Wild is the wheel itself, big.
      colorWheel(ctx, w / 2, h / 2, w * 0.30);
      corners(ctx, CORNER[kind] ?? '', CARD_WHITE);
      return;
    }

    // Draw-wilds get a small wheel behind the number, so you can still tell
    // at a glance that they are colourless.
    oval(ctx, '#000000', 0.35);
    colorWheel(ctx, w / 2, h / 2, w * 0.26);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const label = GLYPH[kind] ?? '';
    centreText(ctx, label, CARD_WHITE, '#000000');
    corners(ctx, CORNER[kind] ?? '', CARD_WHITE);
    return;
  }

  cardBase(ctx, CARD_COLORS[color]);
  oval(ctx);
  const label = kind === 'number' ? String(rank) : (GLYPH[kind] ?? '');
  centreText(ctx, label, CARD_COLORS[color], DEEP[color]);
  corners(ctx, kind === 'number' ? String(rank) : (CORNER[kind] ?? ''), CARD_WHITE);
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
