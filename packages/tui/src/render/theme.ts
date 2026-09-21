/**
 * Visual theme: colours and glyphs.
 *
 * Kept free of OpenTUI imports so it can be unit-tested and reused by any
 * renderer (including a plain-text fallback for narrow terminals).
 */

import type { Card, CardKind, Color } from '@uno/engine';

export const CARD_COLORS: Record<Color, string> = {
  red: '#D7263D',
  yellow: '#F6C90E',
  green: '#2BA84A',
  blue: '#2E86DE',
};

/** Wild cards have no colour of their own until played. */
export const WILD_COLOR = '#C9C9D4';
export const WILD_BG = '#1A1A24';

export const UI = {
  bg: '#0E0E14',
  panel: '#15151F',
  border: '#2E2E3E',
  borderActive: '#F6C90E',
  text: '#E6E6EF',
  dim: '#6B6B80',
  danger: '#FF5C5C',
  good: '#4ADE80',
  accent: '#A78BFA',
} as const;

/** Short label shown in the corners of a card. */
export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'number':
      return String(card.rank);
    case 'drawTwo':
      return '+2';
    case 'drawFour':
      return '+4';
    case 'skip':
      return 'Ø';
    case 'reverse':
      return '⇄';
    case 'skipEveryone':
      return 'ØØ';
    case 'discardAll':
      return '✦';
    case 'wild':
      return 'W';
    case 'wildDrawFour':
      return '+4';
    case 'wildDrawSix':
      return '+6';
    case 'wildDrawTen':
      return '+10';
    case 'wildReverseDrawFour':
      return '⇄4';
    case 'wildColorRoulette':
      return '?';
  }
}

/** Larger centre glyph. */
export function cardGlyph(card: Card): string {
  switch (card.kind) {
    case 'number':
      return String(card.rank);
    case 'drawTwo':
      return '+2';
    case 'drawFour':
      return '+4';
    case 'skip':
      return 'Ø';
    case 'reverse':
      return '⇄';
    case 'skipEveryone':
      return 'ALL';
    case 'discardAll':
      return '✦';
    case 'wild':
      return '◆';
    case 'wildDrawFour':
      return '+4';
    case 'wildDrawSix':
      return '+6';
    case 'wildDrawTen':
      return '+10';
    case 'wildReverseDrawFour':
      return '⇄4';
    case 'wildColorRoulette':
      return '◉';
  }
}

/** Human-readable name, used in the log and for screen readers. */
export const KIND_NAMES: Record<CardKind, string> = {
  number: 'Number',
  drawTwo: 'Draw 2',
  skip: 'Skip',
  reverse: 'Reverse',
  drawFour: 'Draw 4',
  skipEveryone: 'Skip Everyone',
  discardAll: 'Discard All',
  wild: 'Wild',
  wildDrawFour: 'Wild Draw 4',
  wildDrawSix: 'Wild Draw 6',
  wildDrawTen: 'Wild Draw 10',
  wildReverseDrawFour: 'Wild Reverse Draw 4',
  wildColorRoulette: 'Wild Color Roulette',
};

export function cardName(card: Card): string {
  const base = card.kind === 'number' ? `${card.rank}` : KIND_NAMES[card.kind];
  return card.color ? `${card.color} ${base}` : base;
}

export function colorOf(card: Card): string {
  return card.color ? CARD_COLORS[card.color] : WILD_COLOR;
}
