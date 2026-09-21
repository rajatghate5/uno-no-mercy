/**
 * Network lobby: shows the room code to share, who has joined, and lets the
 * host tune the game before dealing.
 */

import { useEffect, useState } from 'react';
import { useKeyboard } from '../render/runtime.js';
import type { Difficulty } from '@uno/bots';
import { UI } from '../render/theme.js';
import type { NetworkGame } from '../game/network.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export function Lobby({ game, onLeave }: { game: NetworkGame; onLeave: () => void }) {
  const [, force] = useState(0);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => game.subscribe(() => force((n) => n + 1)), [game]);

  useKeyboard((key) => {
    const n = key.name;
    if (chatting) {
      if (n === 'escape') {
        setChatting(false);
        setDraft('');
      } else if (n === 'return') {
        game.say(draft);
        setDraft('');
        setChatting(false);
      } else if (n === 'backspace') {
        setDraft((d) => d.slice(0, -1));
      } else if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
        setDraft((d) => (d.length < 200 ? d + key.sequence : d));
      }
      return;
    }
    if (n === 'q' || n === 'escape') return onLeave();
    if (n === 'c') return setChatting(true);
    if (!game.isHost) return;
    if (n === 'return' || n === 's') return game.start();
    const settings = game.settings;
    if (!settings) return;
    if (n === 'left') game.updateSettings({ botCount: Math.max(0, settings.botCount - 1) });
    if (n === 'right') game.updateSettings({ botCount: Math.min(9, settings.botCount + 1) });
    if (n === 'up' || n === 'down') {
      const idx = DIFFICULTIES.indexOf(settings.difficulty);
      const next = n === 'up' ? Math.max(0, idx - 1) : Math.min(DIFFICULTIES.length - 1, idx + 1);
      game.updateSettings({ difficulty: DIFFICULTIES[next]! });
    }
  });

  if (game.status === 'connecting') {
    return <Centered text="connecting…" tone={UI.dim} />;
  }
  if (game.status === 'error') {
    return (
      <box flexGrow={1} backgroundColor={UI.bg} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
        <text fg={UI.danger} attributes={1}>could not join</text>
        <text fg={UI.text}>{game.error ?? 'unknown error'}</text>
        <text fg={UI.dim}>[q] back to menu</text>
      </box>
    );
  }

  const settings = game.settings;

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={UI.bg} padding={2} gap={1}>
      <box flexDirection="row" alignItems="center" gap={2}>
        <text fg={UI.dim}>room code</text>
        <box backgroundColor={UI.borderActive} paddingX={2}>
          <text fg="#0E0E14" attributes={1}>{game.code}</text>
        </box>
        <text fg={UI.dim}>share this — others pick "join" and type it</text>
      </box>

      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={UI.border}
        backgroundColor={UI.panel}
        paddingX={2}
        paddingY={1}
        title=" players "
        titleColor={UI.dim}
        flexGrow={1}
      >
        {game.lobby.length === 0 ? (
          <text fg={UI.dim}>nobody yet</text>
        ) : (
          game.lobby.map((p) => (
            <text key={p.id} fg={p.connected ? UI.text : UI.dim}>
              {p.isHost ? '* ' : '  '}
              {p.name}
              {p.id === game.youId ? '  (you)' : ''}
              {p.connected ? '' : '  (away)'}
            </text>
          ))
        )}
        {game.chat.slice(-5).map((c, i) => (
          <text key={`chat-${i}`} fg={UI.accent}>{`<${c.name}> ${c.text}`}</text>
        ))}
        {chatting ? <text fg={UI.borderActive}>{`say: ${draft}_`}</text> : null}
      </box>

      {settings ? (
        <box flexDirection="row" gap={3}>
          <text fg={UI.dim}>bots </text>
          <text fg={UI.text}>{game.isHost ? `< ${settings.botCount} >` : String(settings.botCount)}</text>
          <text fg={UI.dim}>difficulty </text>
          <text fg={UI.text}>{settings.difficulty}</text>
        </box>
      ) : null}

      <text fg={UI.borderActive}>
        {game.isHost
          ? '←→ bots   ↑↓ difficulty   [↵] start   [c] chat   [q] leave'
          : 'waiting for the host to start…   [c] chat   [q] leave'}
      </text>
    </box>
  );
}

function Centered({ text, tone }: { text: string; tone: string }) {
  return (
    <box flexGrow={1} backgroundColor={UI.bg} justifyContent="center" alignItems="center">
      <text fg={tone}>{text}</text>
    </box>
  );
}
