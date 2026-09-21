/**
 * Card art.
 *
 * OpenTUI types are reached only through ./runtime.js and ./animation.js, so
 * this file stays inside the render boundary. See the README "Gotchas".
 */

import { flashCurve, lerp, lerpColor, useTween } from './animation.js';
import { cardGlyph, cardLabel, colorOf, UI, WILD_BG } from './theme.js';
import type { Card } from '@uno/engine';

/** How far into a card's reveal window it flips from back to face. */
const FLIP_AT = 0.2;

export const CARD_W = 9;
export const CARD_H = 6;

interface CardProps {
  card: Card;
  /** Dim unplayable cards instead of hiding them, so the hand stays readable. */
  playable?: boolean;
  selected?: boolean;
  /** Raise the selected card out of the fan. */
  lifted?: boolean;
  /**
   * 0 -> 1 reveal progress, used to deal cards in rather than popping them.
   * Below the flip point the card renders as a back, so it reads as a flip.
   */
  reveal?: number;
}

export function CardFace({
  card,
  playable = true,
  selected = false,
  lifted = false,
  reveal = 1,
}: CardProps) {
  const color = colorOf(card);
  const isWildCard = !card.color;

  // Still face-down at the start of this card's deal window.
  if (reveal < FLIP_AT) return <CardBack />;

  const faceBg = isWildCard ? WILD_BG : color;
  // Wilds are dark-on-light, coloured cards are light-on-dark: both need a
  // foreground that stays legible against their own background.
  const ink = isWildCard ? color : '#0E0E14';

  // Fade the face in across the remainder of the window.
  const t = (reveal - FLIP_AT) / (1 - FLIP_AT);
  const bg = playable ? lerpColor('#1C1C2A', faceBg, t) : UI.panel;
  const fg = playable ? lerpColor(UI.dim, ink, t) : UI.dim;

  return (
    <box
      width={CARD_W}
      height={CARD_H}
      marginTop={lifted ? 0 : 1}
      border
      borderStyle={selected ? 'double' : 'rounded'}
      borderColor={selected ? UI.borderActive : playable ? lerpColor(UI.border, color, t) : UI.border}
      backgroundColor={bg}
      flexDirection="column"
    >
      <text fg={fg}>{cardLabel(card)}</text>
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <text fg={fg} attributes={1}>
          {cardGlyph(card)}
        </text>
      </box>
    </box>
  );
}

/**
 * The discard pile's top card, which slams down when something is played.
 *
 * The slam is a brief bright border plus a one-row lift, keyed on the card's
 * id so it replays for every new card without replaying on unrelated renders.
 */
export function DiscardCard({ card }: { card: Card | undefined }) {
  const progress = useTween(card?.id ?? 'none', 260, 'outBack');
  if (!card) return <CardBack />;

  const impact = flashCurve(progress);
  const color = colorOf(card);

  return (
    // Fixed height + bottom alignment, so collapsing the spacer genuinely
    // moves the card up. Without a fixed height the parent's alignItems
    // re-centres it and the lift cancels itself out.
    <box flexDirection="column" height={CARD_H + 1} justifyContent="flex-end">
      {/* The lift: one blank row that collapses as the card lands. */}
      <box height={impact > 0.5 ? 0 : 1} flexShrink={0} />
      <box
        border
        borderStyle={impact > 0.35 ? 'double' : 'rounded'}
        borderColor={lerpColor(color, UI.borderActive, impact)}
        backgroundColor={lerpColor(colorOf(card), '#FFFFFF', impact * 0.35)}
        width={CARD_W}
        height={CARD_H}
        flexDirection="column"
      >
        <text fg="#0E0E14">{cardLabel(card)}</text>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg="#0E0E14" attributes={1}>
            {cardGlyph(card)}
          </text>
        </box>
      </box>
    </box>
  );
}

/** Face-down card, for opponents' hands and the draw pile. */
export function CardBack({ count }: { count?: number }) {
  return (
    <box
      width={CARD_W}
      height={CARD_H}
      marginTop={1}
      border
      borderStyle="rounded"
      borderColor={UI.border}
      backgroundColor="#1C1C2A"
      justifyContent="center"
      alignItems="center"
    >
      <text fg={UI.accent}>{count !== undefined ? String(count) : '▚▚'}</text>
    </box>
  );
}

/** Small inline colour swatch for the active-colour indicator. */
export function ColorPip({ color, label }: { color: string; label: string }) {
  return (
    <box backgroundColor={color} paddingX={1} marginRight={1}>
      <text fg="#0E0E14" attributes={1}>
        {label}
      </text>
    </box>
  );
}

export { lerp };
