/**
 * The game table.
 *
 * Layout, top to bottom:
 *   opponents strip   — every bot, hand count, turn marker, threat highlight
 *   centre            — draw pile, discard top, active colour, live stack
 *   log               — recent events
 *   your hand         — fanned, selected card lifted, unplayable cards dimmed
 *   prompt bar        — contextual keys for the current phase
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '../render/runtime.js';
import {
  COLORS,
  playableFor,
  type Card,
  type Color,
  type RedactedState,
} from '@uno/engine';
import { CardBack, CardFace, ColorPip, DiscardCard } from '../render/Card.js';
import { flashCurve, lerpColor, stagger, usePulse, useTween } from '../render/animation.js';
import { CARD_COLORS, UI } from '../render/theme.js';
import { LocalGame } from '../game/local.js';
import type { PlayableGame } from '../game/types.js';
import { Sound } from '../game/sound.js';

const BOT_TURN_DELAY_MS = 550;

export function Table({
  game,
  onExit,
  sound,
}: {
  game: PlayableGame;
  onExit: () => void;
  sound?: Sound | undefined;
}) {
  const [, forceRender] = useState(0);
  const [selected, setSelected] = useState(0);
  const [showLog, setShowLog] = useState(true);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState('');
  const { width, height } = useTerminalDimensions();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenEvent = useRef(0);
  // Stable per-game key, so the deal animation replays on a NEW game only.
  const gameKey = useMemo(() => Math.random(), [game]);

  useEffect(() => game.subscribe(() => forceRender((n) => n + 1)), [game]);

  // Bot turns are driven locally only for in-process games; a networked game
  // has the SERVER step its bots, so the client must not also do it.
  useEffect(() => {
    if (!(game instanceof LocalGame)) return;
    if (game.isOver || game.waitingOnHuman()) return;
    timer.current = setTimeout(() => game.stepBot(), BOT_TURN_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  });

  const view = game.view();

  // Fire sound cues for whatever just happened.
  useEffect(() => {
    if (!sound || !view) return;
    const stamp = game.log.length;
    if (stamp === seenEvent.current) return;
    seenEvent.current = stamp;
    for (const e of game.lastEvents) {
      if (e.type === 'eliminated') sound.play('eliminate');
      else if (e.type === 'stackTaken' && e.count >= 6) sound.play('bigHit');
      else if (e.type === 'gameOver') sound.play(e.winner === game.youId ? 'win' : 'lose');
    }
  }, [game, sound, view]);

  if (!view) {
    return (
      <box flexGrow={1} backgroundColor={UI.bg} justifyContent="center" alignItems="center">
        <text fg={UI.dim}>waiting for the game to start…</text>
      </box>
    );
  }

  const hand = view.players.find((p) => p.id === game.youId)?.hand ?? [];
  // Plays once per game: the opening hand is dealt in rather than popping up.
  // Linear, not outQuad: an eased deal front-loads and the cards clump.
  const dealProgress = useTween(gameKey, 850, 'linear');
  const playable = useMemo(() => new Set(playableFor(view).map((c) => c.id)), [view]);
  const myTurn = game.waitingOnHuman();
  const phase = view.phase.type;

  // Keep the cursor inside the hand as it shrinks and grows.
  const clamped = hand.length === 0 ? 0 : Math.min(selected, hand.length - 1);
  if (clamped !== selected) setSelected(clamped);

  useKeyboard((key) => {
    const name = key.name;

    // Chat swallows every key while it is open, so typing "q" says "q"
    // instead of quitting the game mid-sentence.
    if (chatting) {
      if (name === 'escape') {
        setChatting(false);
        setDraft('');
      } else if (name === 'return') {
        game.say?.(draft);
        setDraft('');
        setChatting(false);
      } else if (name === 'backspace') {
        setDraft((d) => d.slice(0, -1));
      } else if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
        setDraft((d) => (d.length < 200 ? d + key.sequence : d));
      }
      return;
    }

    if (name === 'q' || (name === 'c' && key.ctrl)) return onExit();
    if (name === 'l') return setShowLog((s) => !s);
    if (name === 'm' && sound) {
      sound.toggle();
      return forceRender((n) => n + 1);
    }
    if (name === 'c' && game.say) return setChatting(true);
    if (game.isOver) return;
    if (game.spectator) return;

    // Colour prompts (after a wild, or naming a roulette colour).
    if (myTurn && (phase === 'chooseColor' || phase === 'chooseRouletteColor')) {
      const idx = ['r', 'y', 'g', 'b'].indexOf(name ?? '');
      if (idx >= 0) {
        const color = COLORS[idx]!;
        game.apply(
          phase === 'chooseColor'
            ? { type: 'chooseColor', player: game.youId, color }
            : { type: 'chooseRouletteColor', player: game.youId, color },
        );
      }
      return;
    }

    // Swap prompt: pick an opponent by number.
    if (myTurn && phase === 'chooseSwapTarget') {
      const targets = view.players.filter(
        (p) => p.id !== game.youId && !p.eliminated && !p.finished,
      );
      const n = Number(name);
      if (Number.isInteger(n) && n >= 1 && n <= targets.length) {
        game.apply({ type: 'chooseSwapTarget', player: game.youId, target: targets[n - 1]!.id });
      }
      return;
    }

    if (!myTurn || phase !== 'play') return;

    // Note: 'l' is the log toggle above, so vim-style h/l would be dead code
    // for 'l'. Arrows plus a/d-adjacent keys keep the pair symmetrical instead.
    if (name === 'left' || name === 'a') setSelected((i) => Math.max(0, i - 1));
    else if (name === 'right' || name === 's') setSelected((i) => Math.min(hand.length - 1, i + 1));
    else if (name === 'return' || name === 'space') {
      const card = hand[clamped];
      if (card && playable.has(card.id)) {
        game.apply({ type: 'play', player: game.youId, cardId: card.id });
      }
    } else if (name === 'd') {
      game.apply(
        view.pendingDraw > 0
          ? { type: 'takeStack', player: game.youId }
          : { type: 'draw', player: game.youId },
      );
    }
  });

  const opponents = view.players.filter((p) => p.id !== game.youId);
  const activeId = view.players[view.turn]?.id;

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={UI.bg} padding={1}>
      <Opponents opponents={opponents} activeId={activeId} limit={view.rules.handLimit} />
      <Centre view={view} />
      {showLog ? (
        // Opponents (4) + centre (9) + hand (9) + prompt (1) + borders/padding.
        <Log game={game} rows={Math.max(1, height - 27)} chatting={chatting} draft={draft} />
      ) : (
        <box flexGrow={1} />
      )}
      <Hand
        hand={hand}
        selected={clamped}
        playable={playable}
        myTurn={myTurn && phase === 'play'}
        width={width}
        dealProgress={dealProgress}
      />
      <Prompt view={view} game={game} myTurn={myTurn} chatting={chatting} sound={sound} />
    </box>
  );
}

function Opponents({
  opponents,
  activeId,
  limit,
}: {
  opponents: RedactedState['players'];
  activeId: string | undefined;
  limit: number;
}) {
  return (
    <box flexDirection="row" gap={2} height={4}>
      {opponents.map((p) => (
        <OpponentCard key={p.id} p={p} activeId={activeId} limit={limit} />
      ))}
    </box>
  );
}

function OpponentCard({
  p,
  activeId,
  limit,
}: {
  p: RedactedState['players'][number];
  activeId: string | undefined;
  limit: number;
}) {
  {
    const isTurn = p.id === activeId;
    const out = p.eliminated || p.finished;
    // Colour the count by how close they are to the 25-card wall.
    const pressure = p.handCount / limit;
    const countColor = out
      ? UI.dim
      : pressure > 0.8
        ? UI.danger
        : p.handCount <= 2
          ? UI.good
          : UI.text;

    // One-shot flash the moment this player is knocked out.
    const knockout = flashCurve(useTween(p.eliminated, 700, 'outQuad'));
    const flash = p.eliminated ? knockout : 0;
    // Slow pulse for anyone close to the wall, so the danger is visible.
    const danger = usePulse(!out && pressure > 0.8, 1100);

    const border = p.eliminated
      ? lerpColor(UI.border, UI.danger, flash)
      : isTurn
        ? UI.borderActive
        : danger > 0
          ? lerpColor(UI.border, UI.danger, danger)
          : UI.border;

    return (
      <box
        border
        borderStyle={isTurn ? 'double' : 'rounded'}
        borderColor={border}
        backgroundColor={p.eliminated ? lerpColor(UI.panel, UI.danger, flash * 0.5) : UI.panel}
        paddingX={1}
        flexDirection="column"
      >
        <text fg={out ? UI.dim : UI.text} attributes={isTurn ? 1 : 0}>
          {p.eliminated ? `☠ ${p.name}` : p.finished ? `★ ${p.name}` : p.name}
        </text>
        <text fg={countColor}>{out ? '—' : `${p.handCount} cards`}</text>
      </box>
    );
  }
}

function Centre({ view }: { view: RedactedState }) {
  const top = view.discardTop;
  const activeColor = view.activeColor ? CARD_COLORS[view.activeColor] : UI.dim;
  // A live stack is the most urgent thing on screen; pulse it.
  const stackPulse = usePulse(view.pendingDraw > 0, 700);
  return (
    <box flexDirection="row" alignItems="center" justifyContent="center" gap={3} height={9}>
      <box flexDirection="column" alignItems="center">
        <text fg={UI.dim}>draw</text>
        <CardBack count={view.drawPileCount} />
      </box>

      <box flexDirection="column" alignItems="center">
        <text fg={UI.dim}>discard</text>
        <DiscardCard card={top} />
      </box>

      <box flexDirection="column" gap={1} paddingLeft={2}>
        <box flexDirection="row" alignItems="center">
          <text fg={UI.dim}>colour </text>
          <ColorPip color={activeColor} label={view.activeColor ?? 'none'} />
        </box>
        <text fg={view.direction === 1 ? UI.text : UI.accent}>
          {view.direction === 1 ? '↻ clockwise' : '↺ counter-clockwise'}
        </text>
        {view.pendingDraw > 0 ? (
          <text fg={lerpColor(UI.danger, '#FFFFFF', stackPulse)} attributes={1}>
            ⚠ STACK +{view.pendingDraw} (need ≥ +{view.stackValue})
          </text>
        ) : (
          <text fg={UI.dim}>no stack</text>
        )}
      </box>
    </box>
  );
}

function Log({
  game,
  rows,
  chatting,
  draft,
}: {
  game: PlayableGame;
  rows: number;
  chatting: boolean;
  draft: string;
}) {
  const chat = game.chat ?? [];
  // Interleave chat into the log so you never miss a message mid-hand.
  const merged = [
    ...game.log.map((l) => ({ text: l.text, tone: l.tone })),
    ...chat.map((c) => ({ text: `<${c.name}> ${c.text}`, tone: 'accent' as const })),
  ];
  const lines = merged.slice(-rows);
  const toneColor = { normal: UI.dim, good: UI.good, bad: UI.danger, accent: UI.accent } as const;
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={UI.border}
      backgroundColor={UI.panel}
      paddingX={1}
      title=" log "
      titleColor={UI.dim}
    >
      {lines.length === 0 ? (
        <text fg={UI.dim}>no moves yet</text>
      ) : (
        lines.map((l, i) => (
          <text key={i} fg={toneColor[l.tone]}>
            {l.text}
          </text>
        ))
      )}
      {chatting ? <text fg={UI.borderActive}>{`say: ${draft}_`}</text> : null}
    </box>
  );
}

function Hand({
  hand,
  selected,
  playable,
  myTurn,
  width,
  dealProgress,
}: {
  hand: readonly Card[];
  selected: number;
  playable: Set<string>;
  myTurn: boolean;
  width: number;
  dealProgress: number;
}) {
  // Show a window around the cursor so a 25-card hand still fits the terminal.
  const perRow = Math.max(3, Math.floor((width - 4) / 10));
  const start = Math.max(0, Math.min(selected - Math.floor(perRow / 2), hand.length - perRow));
  const visible = hand.slice(Math.max(0, start), Math.max(0, start) + perRow);
  const offset = Math.max(0, start);

  return (
    <box flexDirection="column" height={9} justifyContent="flex-end">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={UI.dim}>
          your hand — {hand.length} card{hand.length === 1 ? '' : 's'}
        </text>
        {hand.length > perRow ? (
          <text fg={UI.dim}>
            {offset + 1}-{Math.min(offset + perRow, hand.length)} of {hand.length}
          </text>
        ) : null}
      </box>
      <box flexDirection="row" gap={1} height={7}>
        {visible.map((card, i) => {
          const idx = offset + i;
          const isSel = idx === selected;
          return (
            <CardFace
              key={card.id}
              card={card}
              playable={playable.has(card.id)}
              selected={isSel && myTurn}
              lifted={isSel && myTurn}
              reveal={stagger(dealProgress, i, visible.length)}
            />
          );
        })}
      </box>
    </box>
  );
}

function Prompt({
  view,
  game,
  myTurn,
  chatting,
  sound,
}: {
  view: RedactedState;
  game: PlayableGame;
  myTurn: boolean;
  chatting: boolean;
  sound?: Sound | undefined;
}) {
  let text: string;
  let tone: string = UI.dim;

  if (chatting) {
    text = 'chat: type your message, [↵] send, [esc] cancel';
    tone = UI.accent;
  } else if (game.isOver) {
    const w = game.winner;
    text = w === game.youId ? 'YOU WIN — q to quit' : `${nameOf(view, w)} wins — q to quit`;
    tone = w === game.youId ? UI.good : UI.danger;
  } else if (game.spectator) {
    text = `spectating — ${nameOf(view, view.players[view.turn]?.id ?? null)} to play   [q] leave`;
  } else if (!myTurn) {
    text = `${nameOf(view, view.players[view.turn]?.id ?? null)} is thinking…`;
  } else
    switch (view.phase.type) {
      case 'chooseColor':
        text = 'choose a colour:  [r] red  [y] yellow  [g] green  [b] blue';
        tone = UI.borderActive;
        break;
      case 'chooseRouletteColor':
        text = 'ROULETTE — name the colour you must draw to:  [r] [y] [g] [b]';
        tone = UI.danger;
        break;
      case 'chooseSwapTarget': {
        const targets = view.players.filter((p) => p.id !== game.youId && !p.eliminated && !p.finished);
        text = `swap hands with:  ${targets.map((p, i) => `[${i + 1}] ${p.name} (${p.handCount})`).join('  ')}`;
        tone = UI.accent;
        break;
      }
      default: {
        const draw = view.pendingDraw > 0 ? `[d] eat +${view.pendingDraw}` : '[d] draw';
        const chatKey = game.say ? '   [c] chat' : '';
        const muteKey = sound ? `   [m] ${sound.enabled ? 'mute' : 'unmute'}` : '';
        text = `←/→ select   [↵] play   ${draw}   [l] log${chatKey}${muteKey}   [q] quit`;
        tone = UI.borderActive;
      }
    }

  return (
    <box height={1} paddingX={1}>
      <text fg={tone}>{text}</text>
    </box>
  );
}

function nameOf(view: RedactedState, id: string | null): string {
  if (!id) return 'nobody';
  return view.players.find((p) => p.id === id)?.name ?? id;
}
