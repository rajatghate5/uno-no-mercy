/**
 * Entry point and screen router.
 *
 * Routes: menu -> (solo table | lobby -> network table | stats).
 * Also owns the pieces that outlive a single screen: the stats store, the
 * sound player, and the server URL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCliRenderer, createRoot } from './render/runtime.js';
import { installShutdown, quit } from './render/shutdown.js';
import { LocalGame } from './game/local.js';
import { NetworkGame } from './game/network.js';
import { Sound } from './game/sound.js';
import { Store } from './game/store.js';
import { Menu, type MenuChoice } from './screens/Menu.js';
import { Lobby } from './screens/Lobby.js';
import { StatsScreen } from './screens/Stats.js';
import { Table } from './screens/Table.js';

type Screen =
  | { kind: 'menu' }
  | { kind: 'solo'; game: LocalGame; difficulty: string; startedAt: number }
  | { kind: 'net'; game: NetworkGame }
  | { kind: 'stats' };

const SERVER_URL = process.env.UNO_SERVER ?? 'ws://127.0.0.1:4040';
const DEFAULT_NAME = (process.env.UNO_NAME || process.env.USER || 'player').slice(0, 16);

function App({ store, sound, onQuit }: { store: Store; sound: Sound; onQuit: () => void }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });

  const choose = useCallback((choice: MenuChoice) => {
    switch (choice.kind) {
      case 'solo': {
        const game = new LocalGame({
          // Seeded per game so any session can be replayed or bug-reported.
          seed: (Math.random() * 0xffffffff) >>> 0,
          humanName: DEFAULT_NAME,
          botCount: choice.botCount,
          difficulty: choice.difficulty,
        });
        setScreen({ kind: 'solo', game, difficulty: choice.difficulty, startedAt: Date.now() });
        return;
      }
      case 'host':
        setScreen({
          kind: 'net',
          game: new NetworkGame({
            url: SERVER_URL,
            name: choice.name,
            mode: {
              kind: 'create',
              settings: { botCount: choice.botCount, difficulty: choice.difficulty, maxPlayers: 6 },
            },
          }),
        });
        return;
      case 'join':
        setScreen({
          kind: 'net',
          game: new NetworkGame({
            url: SERVER_URL,
            name: choice.name,
            mode: { kind: 'join', code: choice.code },
          }),
        });
        return;
      case 'spectate':
        setScreen({
          kind: 'net',
          game: new NetworkGame({
            url: SERVER_URL,
            name: choice.name,
            mode: { kind: 'spectate', code: choice.code },
          }),
        });
        return;
      case 'stats':
        setScreen({ kind: 'stats' });
        return;
    }
  }, []);

  const backToMenu = useCallback(() => setScreen({ kind: 'menu' }), []);

  switch (screen.kind) {
    case 'menu':
      return <Menu onChoose={choose} onQuit={onQuit} defaultName={DEFAULT_NAME} />;

    case 'stats':
      return <StatsScreen store={store} onBack={backToMenu} />;

    case 'solo':
      return (
        <SoloTable
          screen={screen}
          store={store}
          sound={sound}
          onExit={backToMenu}
        />
      );

    case 'net':
      return <NetScreen game={screen.game} sound={sound} onExit={backToMenu} />;
  }
}

/** Wraps the table so a finished solo game gets recorded exactly once. */
function SoloTable({
  screen,
  store,
  sound,
  onExit,
}: {
  screen: Extract<Screen, { kind: 'solo' }>;
  store: Store;
  sound: Sound;
  onExit: () => void;
}) {
  const { game, difficulty, startedAt } = screen;
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (recorded || !game.isOver) return;
    setRecorded(true);

    const raw = game.raw;
    const you = raw.players.find((p) => p.id === game.youId);
    const won = game.winner === game.youId;
    // A negative place marks elimination, which the stats query counts.
    const place = you?.eliminated ? -1 : won ? 1 : 2;
    const worstHit = game.log.reduce((max, l) => {
      const m = /ate the stack - (\d+) cards/.exec(l.text);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);

    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
    const replayFile = store.saveReplay(game.finishReplay(), `${stamp}-seed${raw.rng >>> 0}`);

    store.record({
      playedAt: startedAt,
      seed: raw.rng >>> 0,
      players: raw.players.length,
      bots: raw.players.filter((p) => p.isBot).length,
      difficulty,
      won,
      place,
      turns: game.log.length,
      eliminations: raw.players.filter((p) => p.eliminated).length,
      worstHit,
      durationMs: Date.now() - startedAt,
      replayFile,
    });
  }, [game, game.isOver, recorded, store, difficulty, startedAt]);

  // Re-render when the game ends so the effect above runs.
  const [, force] = useState(0);
  useEffect(() => game.subscribe(() => force((n) => n + 1)), [game]);

  return <Table game={game} onExit={onExit} sound={sound} />;
}

/** Lobby until the game starts, then the table. */
function NetScreen({
  game,
  sound,
  onExit,
}: {
  game: NetworkGame;
  sound: Sound;
  onExit: () => void;
}) {
  const [, force] = useState(0);
  useEffect(() => game.subscribe(() => force((n) => n + 1)), [game]);

  const leave = useCallback(() => {
    game.leave();
    onExit();
  }, [game, onExit]);

  const started = game.status === 'playing' || (game.status === 'ended' && game.view() !== null);
  if (!started) return <Lobby game={game} onLeave={leave} />;
  return <Table game={game} onExit={leave} sound={sound} />;
}

function Root({ onQuit }: { onQuit: () => void }) {
  // One store and one sound player for the whole session.
  const store = useMemo(() => new Store(), []);
  const sound = useMemo(() => new Sound(process.env.UNO_MUTE !== '1'), []);
  return <App store={store} sound={sound} onQuit={onQuit} />;
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });

// Must be installed BEFORE the first render: if the app crashes on startup we
// still have to hand the terminal back with mouse reporting switched off.
installShutdown(renderer);

createRoot(renderer).render(<Root onQuit={() => quit(renderer)} />);
