/**
 * Entry point.
 *
 * Owns the render loop, the current screen, and the bridge between a game
 * controller (LocalGame or NetworkGame) and the 3D table.
 *
 * The controllers are the same ones the terminal build used: they were always
 * UI-agnostic, so swapping a terminal renderer for a WebGL one did not touch
 * a line of game logic.
 */

import { Vector3 } from 'three';
import { COLORS, type Color } from '@uno/engine';
import type { Difficulty } from '@uno/bots';
import { LocalGame } from './game/local.js';
import { NetworkGame } from './game/network.js';
import { Sound } from './game/sound.js';
import { DEFAULT_ROOM_SETTINGS } from '@uno/protocol';
import { resolveServer } from './game/serverUrl.js';
import { Store } from './game/store.js';
import type { PlayableGame } from './game/types.js';
import { warmCardArt } from './scene/cardArt.js';
import { createStage } from './scene/table.js';
import { TableView } from './scene/tableView.js';
import {
  HAND_Z_LANDSCAPE,
  HAND_Z_PORTRAIT,
  seatAngle,
  seatPosition,
  visibleWidthAtHand,
} from './scene/layout.js';
import { TABLE_RADIUS } from './scene/table.js';
import { Hud, Screens, type MenuChoice } from './ui/screens.js';

// Where the multiplayer server lives, and whether one is reachable at all.
const { url: SERVER_URL, multiplayer: MULTIPLAYER_AVAILABLE } = resolveServer({
  configured: import.meta.env.VITE_UNO_SERVER as string | undefined,
  sameOrigin: import.meta.env.VITE_UNO_SAME_ORIGIN as string | undefined,
  protocol: location.protocol,
  hostname: location.hostname,
  port: location.port,
});

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudLayer = document.getElementById('hud-layer') as HTMLElement;
const screenLayer = document.getElementById('screen-layer') as HTMLElement;

const stage = createStage(canvas);
const view = new TableView(stage.scene);
const screens = new Screens(screenLayer);
const store = new Store();
const sound = new Sound(localStorage.getItem('uno:muted') !== '1');

let game: PlayableGame | null = null;
let hud: Hud | null = null;
let unsubscribe: (() => void) | null = null;
let botTimer: number | null = null;
let gameMeta: { difficulty: string; startedAt: number; bots: number } | null = null;
let recorded = false;

const defaultName = localStorage.getItem('uno:name') || 'player';

/**
 * Touch devices have no hover, so the lift-to-preview never fires and the
 * first tap would commit a card immediately. On touch we require two taps:
 * one to raise the card, a second on the SAME card to play it. Mis-taps then
 * cost a correction instead of a turn.
 */
const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

// --- render loop -----------------------------------------------------------

let last = performance.now();
function frame(now: number) {
  const dt = now - last;
  last = now;
  view.animator.update(dt);
  positionSeats();
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}

/** Project each 3D seat to screen space so its HTML label tracks it. */
function positionSeats() {
  const state = game?.view();
  if (!state || !hud) return;
  const viewerIndex = Math.max(
    0,
    state.players.findIndex((p) => p.id === state.viewer),
  );
  hud.seats(
    state,
    (i, size) => {
      const angle = seatAngle(i, viewerIndex, state.players.length);
      const [x, z] = seatPosition(angle, TABLE_RADIUS - 0.25);
      // Viewer's own seat would sit under the hand; hide it.
      if (i === viewerIndex) return null;
      const p = new Vector3(x, 0.35, z).project(stage.camera);
      const portrait = window.innerWidth < window.innerHeight;

      // Clamp by the label's MEASURED half-width, not a guessed constant.
      // Labels are translate(-50%,-50%) centred, so a fixed pad let wider
      // chips hang off the edge on a tablet while looking fine on a phone.
      const padX = size.width / 2 + 6;
      const padY = size.height / 2 + 4;
      const topFloor = (portrait ? 150 : 128) + padY;

      return {
        x: clamp(((p.x + 1) / 2) * window.innerWidth, padX, window.innerWidth - padX),
        y: clamp(
          ((-p.y + 1) / 2) * window.innerHeight,
          topFloor,
          window.innerHeight - (portrait ? 300 : 260),
        ),
      };
    },
    state.rules.handLimit,
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Measure how much world-width the hand may occupy, from the LIVE camera.
 *
 * Recomputed per update rather than cached, because the camera moves between
 * portrait and landscape and a stale budget overflows the viewport.
 */
function handWidthBudget(): number {
  const aspect = window.innerWidth / window.innerHeight;
  const handZ = aspect < 1 ? HAND_Z_PORTRAIT : HAND_Z_LANDSCAPE;
  const cam = stage.camera.position;
  const distance = Math.hypot(cam.y - 0.46, cam.z - handZ);
  return visibleWidthAtHand(aspect, stage.camera.fov, distance);
}

/**
 * How long a bot "thinks" before acting in a solo game.
 *
 * Long enough for the previous card's animation to land, so the table is
 * readable rather than a blur of cards.
 */
const BOT_DELAY_MS = 750;

function stopBotLoop() {
  if (botTimer !== null) {
    clearTimeout(botTimer);
    botTimer = null;
  }
}

/**
 * Drive bot turns in a SOLO game.
 *
 * Only local games need this. In a networked game the server owns the state
 * and steps its own bots; a client that also stepped them would race the
 * server and submit duplicate moves.
 *
 * Each step triggers onStateChange, which calls back in here - so this is a
 * self-sustaining loop that stops on its own the moment it is the human's
 * turn or the game ends.
 */
function scheduleBotTurn() {
  stopBotLoop();
  const g = game;
  if (!(g instanceof LocalGame)) return;
  if (g.isOver || g.waitingOnHuman()) return;
  botTimer = window.setTimeout(() => {
    botTimer = null;
    g.stepBot();
  }, BOT_DELAY_MS);
}

// --- game wiring -----------------------------------------------------------

function detach() {
  unsubscribe?.();
  unsubscribe = null;
  hud?.destroy();
  hud = null;
  game = null;
  view.reset();
  stopBotLoop();
  recorded = false;
}

function startSolo(bots: number, difficulty: Difficulty) {
  const g = new LocalGame({
    seed: (Math.random() * 0xffffffff) >>> 0,
    humanName: defaultName,
    botCount: bots,
    difficulty,
  });
  gameMeta = { difficulty, startedAt: Date.now(), bots };
  attach(g);
}

function attach(g: PlayableGame) {
  detach();
  game = g;
  // Close the panel BEFORE building the HUD. They live in separate layers now,
  // but ordering still matters for what the player sees first.
  screens.close();
  hud = new Hud(hudLayer);
  hud.corner([
    {
      label: sound.enabled ? 'Sound on' : 'Sound off',
      onClick: () => {
        const on = sound.toggle();
        localStorage.setItem('uno:muted', on ? '0' : '1');
        refreshHud();
      },
    },
    { label: 'Leave', onClick: toMenu },
  ]);
  if (g.say) hud.enableChat((text) => g.say?.(text));
  unsubscribe = g.subscribe(onStateChange);
  onStateChange();
}

function onStateChange() {
  const g = game;
  if (!g) return;
  const state = g.view();
  if (!state) return;

  // Feed the 3D table the same events that drive the log, so a card flies
  // from the seat that actually played it.
  const aspect = window.innerWidth / window.innerHeight;
  view.update(state, g.lastEvents, aspect, handWidthBudget());
  cueSounds(g);
  refreshHud();

  if (g.isOver) {
    stopBotLoop();
    finishGame(g);
    return;
  }

  // Keep the table moving: if it is a bot's turn, queue their move.
  scheduleBotTurn();
}

function cueSounds(g: PlayableGame) {
  for (const e of g.lastEvents) {
    if (e.type === 'cardPlayed') sound.play('play');
    else if (e.type === 'drew') sound.play('draw');
    else if (e.type === 'stackTaken' && e.count >= 6) sound.play('bigHit');
    else if (e.type === 'eliminated') sound.play('eliminate');
    else if (e.type === 'gameOver') sound.play(e.winner === g.youId ? 'win' : 'lose');
  }
}

function refreshHud() {
  const g = game;
  const state = g?.view();
  if (!g || !state || !hud) return;

  hud.chips(state);
  hud.log(g.log);
  if (g.chat) hud.chat(g.chat);
  hud.corner([
    {
      label: sound.enabled ? 'Sound on' : 'Sound off',
      onClick: () => {
        const on = sound.toggle();
        localStorage.setItem('uno:muted', on ? '0' : '1');
        refreshHud();
      },
    },
    { label: 'Leave', onClick: toMenu },
  ]);

  if (g.isOver) return hud.clearPrompt();

  if (g.spectator) {
    const upName = state.players[state.turn]?.name ?? '';
    return hud.prompt({ label: `Spectating — ${upName} to play` });
  }

  if (!g.waitingOnHuman()) {
    const upName = state.players[state.turn]?.name ?? 'someone';
    return hud.prompt({ label: `${upName}…` });
  }

  const phase = state.phase;

  if (phase.type === 'chooseColor' || phase.type === 'chooseRouletteColor') {
    return hud.prompt({
      label:
        phase.type === 'chooseColor'
          ? 'Pick a colour'
          : 'Roulette — name the colour you must draw to',
      colors: [...COLORS],
      onPick: (c: Color) =>
        g.apply(
          phase.type === 'chooseColor'
            ? { type: 'chooseColor', player: g.youId, color: c }
            : { type: 'chooseRouletteColor', player: g.youId, color: c },
        ),
    });
  }

  if (phase.type === 'chooseSwapTarget') {
    const targets = state.players.filter(
      (p) => p.id !== g.youId && !p.eliminated && !p.finished,
    );
    return hud.prompt({
      label: 'Swap hands with',
      buttons: targets.map((t) => ({
        label: `${t.name} (${t.handCount})`,
        onClick: () => g.apply({ type: 'chooseSwapTarget', player: g.youId, target: t.id }),
      })),
    });
  }

  const narrow = window.innerWidth < 560;
  hud.prompt({
    label: narrow
      ? isTouch
        ? 'Your turn — tap a card, tap again to play'
        : 'Your turn'
      : 'Your turn — click a card to play it',
    buttons: [
      {
        label: state.pendingDraw > 0 ? `Take +${state.pendingDraw}` : 'Draw a card',
        onClick: () =>
          g.apply(
            state.pendingDraw > 0
              ? { type: 'takeStack', player: g.youId }
              : { type: 'draw', player: g.youId },
          ),
      },
    ],
  });
}

function finishGame(g: PlayableGame) {
  if (recorded) return;
  recorded = true;

  const won = g.winner === g.youId;

  // Only solo games have a meaningful local record; a networked game's stats
  // would need the server to attest them.
  if (g instanceof LocalGame && gameMeta) {
    const raw = g.raw;
    const you = raw.players.find((p) => p.id === g.youId);
    const worstHit = g.log.reduce((max, l) => {
      const m = /ate the stack - (\d+) cards/.exec(l.text);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    store.record({
      playedAt: gameMeta.startedAt,
      seed: raw.rng >>> 0,
      players: raw.players.length,
      bots: gameMeta.bots,
      difficulty: gameMeta.difficulty,
      won,
      eliminated: !!you?.eliminated,
      turns: g.log.length,
      eliminations: raw.players.filter((p) => p.eliminated).length,
      worstHit,
      durationMs: Date.now() - gameMeta.startedAt,
    });
  }

  const winnerName =
    g.view()?.players.find((p) => p.id === g.winner)?.name ?? 'Nobody';

  // Let the final animation land before the panel covers the table.
  window.setTimeout(() => {
    screens.gameOver(
      won,
      winnerName,
      () => {
        if (gameMeta && game instanceof LocalGame) {
          startSolo(gameMeta.bots, gameMeta.difficulty as Difficulty);
        } else {
          toMenu();
        }
      },
      toMenu,
    );
  }, 900);
}

// --- pointer interaction ---------------------------------------------------

function relayout() {
  const g = game;
  const state = g?.view();
  if (state) view.update(state, [], window.innerWidth / window.innerHeight, stage.camera.fov);
}

function playable(): { hand: readonly { id: string }[] } | null {
  const g = game;
  if (!g || g.isOver || g.spectator || !g.waitingOnHuman()) return null;
  const state = g.view();
  if (!state || state.phase.type !== 'play') return null;
  return { hand: state.players.find((p) => p.id === g.youId)?.hand ?? [] };
}

canvas.addEventListener('pointermove', (e) => {
  if (isTouch) return; // a finger "moving" is a drag, not a hover
  if (!playable()) return;
  const hit = view.pick(e.clientX, e.clientY, stage.camera);
  if (hit !== view.selected) {
    view.selected = hit;
    relayout();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  sound.resume();
  const ctx = playable();
  if (!ctx) return;

  const hit = view.pick(e.clientX, e.clientY, stage.camera);

  if (isTouch) {
    // Tapping away from the hand just clears the selection.
    if (hit < 0) {
      if (view.selected !== -1) {
        view.selected = -1;
        relayout();
      }
      return;
    }
    // First tap on a card raises it; second tap on the same card commits.
    if (hit !== view.selected) {
      view.selected = hit;
      relayout();
      sound.play('draw');
      return;
    }
  }

  if (hit < 0) return;
  const card = ctx.hand[hit];
  if (!card) return;
  // The engine rejects illegal moves; applying is how we find out.
  game?.apply({ type: 'play', player: game.youId, cardId: card.id });
  view.selected = -1;
});

// --- screens ---------------------------------------------------------------

function toMenu() {
  detach();
  screens.menu({
    defaultName,
    serverUrl: SERVER_URL,
    multiplayer: MULTIPLAYER_AVAILABLE,
    onStats: () =>
      screens.stats(
        store.stats(),
        store.recent(8),
        toMenu,
        () => {
          store.clear();
          toMenu();
        },
      ),
    onChoose: (choice) => {
      sound.resume();
      if (choice.kind === 'solo') return startSolo(choice.bots, choice.difficulty);

      localStorage.setItem('uno:name', choice.name);
      const net = new NetworkGame({
        url: SERVER_URL,
        name: choice.name,
        mode:
          choice.kind === 'host'
            ? {
                kind: 'create',
                settings: {
                  ...DEFAULT_ROOM_SETTINGS,
                  botCount: choice.bots,
                  difficulty: choice.difficulty,
                  maxPlayers: choice.seats,
                },
              }
            : choice.kind === 'join'
              ? { kind: 'join', code: choice.code }
              : { kind: 'spectate', code: choice.code },
      });
      watchLobby(net);
    },
  });
}

/** Sit in the lobby until the server actually deals. */
function watchLobby(net: NetworkGame) {
  let attached = false;
  const render = () => {
    if (attached) return;
    if (net.view()) {
      attached = true;
      off();
      attach(net);
      return;
    }
    screens.lobby({
      code: net.code,
      players: net.lobby,
      settings: net.settings,
      isHost: net.isHost,
      youId: net.youId,
      error: net.status === 'error' || net.status === 'closed' ? net.error : null,
      connecting: net.status === 'connecting',
      onStart: () => net.start(),
      onSettings: (s) => net.updateSettings(s),
      onLeave: () => {
        off();
        net.leave();
        toMenu();
      },
    });
  };
  const off = net.subscribe(render);
  render();
}

// --- boot ------------------------------------------------------------------

screens.loading('Drawing the deck…');
// Give the browser a frame to paint the loading text before we block it
// rasterising seventy card faces.
requestAnimationFrame(() => {
  warmCardArt();
  toMenu();
  requestAnimationFrame(frame);
});
