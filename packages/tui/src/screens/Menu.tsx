/**
 * Main menu: pick a mode, then configure it.
 *
 * Modes are deliberately flat (no nested submenus) so the whole game is
 * reachable in at most two keystrokes from launch.
 */

import { useState } from 'react';
import { useKeyboard } from '../render/runtime.js';
import type { Difficulty } from '@uno/bots';
import { CODE_ALPHABET, CODE_LENGTH } from '@uno/protocol';
import { UI } from '../render/theme.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'plays a random legal card - good for learning the rules',
  medium: 'holds its draw cards for defence and steers to its best colour',
  hard: 'counts the deck, tracks voids, and targets whoever is closest to out',
};

export type MenuChoice =
  | { kind: 'solo'; botCount: number; difficulty: Difficulty }
  | { kind: 'host'; botCount: number; difficulty: Difficulty; name: string }
  | { kind: 'join'; code: string; name: string }
  | { kind: 'spectate'; code: string; name: string }
  | { kind: 'stats' };

type Pane = 'modes' | 'solo' | 'host' | 'join' | 'spectate';

const MODES: { key: Pane | 'stats'; label: string; blurb: string }[] = [
  { key: 'solo', label: 'play vs bots', blurb: 'offline, no server needed' },
  { key: 'host', label: 'host a game', blurb: 'get a room code to share with friends' },
  { key: 'join', label: 'join a game', blurb: 'type a friend room code' },
  { key: 'spectate', label: 'spectate', blurb: 'watch a game without playing' },
  { key: 'stats', label: 'your record', blurb: 'match history and win rate' },
];

export function Menu({
  onChoose,
  onQuit,
  defaultName,
}: {
  onChoose: (c: MenuChoice) => void;
  onQuit: () => void;
  defaultName: string;
}) {
  const [pane, setPane] = useState<Pane>('modes');
  const [modeIdx, setModeIdx] = useState(0);
  const [botCount, setBotCount] = useState(3);
  const [diffIdx, setDiffIdx] = useState(1);
  const [row, setRow] = useState(0);
  const [code, setCode] = useState('');
  const [name, setName] = useState(defaultName);
  const [field, setField] = useState<'code' | 'name'>('code');

  const difficulty = DIFFICULTIES[diffIdx]!;

  useKeyboard((key) => {
    const n = key.name;
    if (n === 'q' && pane === 'modes') return onQuit();
    if (n === 'escape') {
      if (pane === 'modes') return onQuit();
      setPane('modes');
      return;
    }

    if (pane === 'modes') {
      if (n === 'up') setModeIdx((i) => Math.max(0, i - 1));
      if (n === 'down') setModeIdx((i) => Math.min(MODES.length - 1, i + 1));
      if (n === 'return' || n === 'space') {
        const chosen = MODES[modeIdx]!.key;
        if (chosen === 'stats') return onChoose({ kind: 'stats' });
        setPane(chosen);
        setRow(0);
        setField(chosen === 'join' || chosen === 'spectate' ? 'code' : 'code');
      }
      return;
    }

    if (pane === 'solo' || pane === 'host') {
      if (n === 'up') setRow((r) => Math.max(0, r - 1));
      if (n === 'down') setRow((r) => Math.min(pane === 'host' ? 2 : 1, r + 1));
      if (n === 'left') {
        if (row === 0) setBotCount((c) => Math.max(pane === 'host' ? 0 : 1, c - 1));
        else if (row === 1) setDiffIdx((d) => Math.max(0, d - 1));
      }
      if (n === 'right') {
        if (row === 0) setBotCount((c) => Math.min(9, c + 1));
        else if (row === 1) setDiffIdx((d) => Math.min(DIFFICULTIES.length - 1, d + 1));
      }
      // The host pane has a name field on row 2.
      if (pane === 'host' && row === 2) {
        if (n === 'backspace') setName((v) => v.slice(0, -1));
        else if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
          setName((v) => (v.length < 16 ? v + key.sequence : v));
        }
      }
      if (n === 'return') {
        if (pane === 'solo') onChoose({ kind: 'solo', botCount, difficulty });
        else onChoose({ kind: 'host', botCount, difficulty, name: name.trim() || defaultName });
      }
      return;
    }

    // join / spectate: a code field and a name field
    if (n === 'tab' || n === 'up' || n === 'down') {
      setField((f) => (f === 'code' ? 'name' : 'code'));
      return;
    }
    if (n === 'backspace') {
      if (field === 'code') setCode((c) => c.slice(0, -1));
      else setName((v) => v.slice(0, -1));
      return;
    }
    if (n === 'return') {
      if (code.length !== CODE_LENGTH) return;
      const payload = { code, name: name.trim() || defaultName };
      onChoose(pane === 'join' ? { kind: 'join', ...payload } : { kind: 'spectate', ...payload });
      return;
    }
    if (key.sequence && key.sequence.length === 1) {
      if (field === 'code') {
        const ch = key.sequence.toUpperCase();
        // Only accept characters that can actually appear in a room code, so
        // a typo is rejected at the keystroke rather than at the server.
        if (CODE_ALPHABET.includes(ch) && code.length < CODE_LENGTH) setCode((c) => c + ch);
      } else if (key.sequence >= ' ') {
        setName((v) => (v.length < 16 ? v + key.sequence : v));
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={UI.bg} justifyContent="center" alignItems="center" gap={1}>
      <text fg={UI.danger} attributes={1}>UNO - SHOW EM NO MERCY</text>
      <text fg={UI.dim}>168 cards - stacking - 7s swap - 0s pass - 25 cards and you are out</text>

      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={UI.border}
        backgroundColor={UI.panel}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        gap={1}
        width={66}
      >
        {pane === 'modes' ? (
          <>
            {MODES.map((m, i) => (
              <box key={m.key} flexDirection="row" justifyContent="space-between">
                <text fg={i === modeIdx ? UI.borderActive : UI.dim} attributes={i === modeIdx ? 1 : 0}>
                  {i === modeIdx ? '> ' : '  '}
                  {m.label}
                </text>
                <text fg={UI.dim}>{m.blurb}</text>
              </box>
            ))}
          </>
        ) : pane === 'solo' || pane === 'host' ? (
          <>
            <Row label="opponents" value={`< ${botCount} bot${botCount === 1 ? '' : 's'} >`} active={row === 0} />
            <Row label="bot difficulty" value={`< ${difficulty} >`} active={row === 1} />
            {pane === 'host' ? <Row label="your name" value={`${name}${row === 2 ? '_' : ''}`} active={row === 2} /> : null}
            <text fg={UI.dim}>{DIFFICULTY_BLURB[difficulty]}</text>
          </>
        ) : (
          <>
            <Row label="room code" value={`${code.padEnd(CODE_LENGTH, '.')}${field === 'code' ? '_' : ''}`} active={field === 'code'} />
            <Row label="your name" value={`${name}${field === 'name' ? '_' : ''}`} active={field === 'name'} />
            <text fg={UI.dim}>
              {code.length === CODE_LENGTH ? 'press enter to connect' : `${CODE_LENGTH - code.length} more characters`}
            </text>
          </>
        )}
      </box>

      <box marginTop={1}>
        <text fg={UI.borderActive}>
          {pane === 'modes'
            ? 'up/down choose   [enter] select   [q] quit'
            : pane === 'join' || pane === 'spectate'
              ? '[tab] switch field   [enter] connect   [esc] back'
              : 'up/down row   left/right change   [enter] go   [esc] back'}
        </text>
      </box>
    </box>
  );
}

function Row({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={active ? UI.borderActive : UI.dim} attributes={active ? 1 : 0}>
        {active ? '> ' : '  '}
        {label}
      </text>
      <text fg={active ? UI.text : UI.dim}>{value}</text>
    </box>
  );
}
