/**
 * The HTML layer: menus, lobby, stats, and the in-game HUD.
 *
 * Three draws the table; everything that is text lives here as DOM, because
 * text rendered into WebGL is worse at every one of the things text needs to
 * be good at - selection, accessibility, reflow and crispness.
 */

import { COLORS, type Color, type RedactedState } from '@uno/engine';
import type { Difficulty } from '@uno/bots';
import type { ChatMessage, LobbyPlayer, RoomSettings } from '@uno/protocol';
import { CARD_COLORS } from '../scene/cardArt.js';
import type { LogEntry } from '../game/narrate.js';
import type { Stats } from '../game/store.js';
import { clear, el } from './dom.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const BLURB: Record<Difficulty, string> = {
  easy: 'Plays a random legal card. Good for learning the rules.',
  medium: 'Holds its draw cards for defence and steers toward its best colour.',
  hard: 'Counts the deck, tracks what you are void in, and targets whoever is closest to going out.',
};

export type MenuChoice =
  | { kind: 'solo'; bots: number; difficulty: Difficulty }
  | { kind: 'host'; bots: number; difficulty: Difficulty; name: string }
  | { kind: 'join'; code: string; name: string }
  | { kind: 'spectate'; code: string; name: string };

export class Screens {
  constructor(private readonly root: HTMLElement) {}

  private panel(...children: (Node | string)[]): HTMLElement {
    const screen = el('div', { class: 'screen' }, [el('div', { class: 'card-panel' }, children)]);
    clear(this.root);
    this.root.append(screen);
    return screen;
  }

  close(): void {
    clear(this.root);
  }

  loading(message: string): void {
    clear(this.root);
    this.root.append(el('div', { class: 'loading', text: message }));
  }

  // --- main menu -----------------------------------------------------------

  menu(opts: {
    defaultName: string;
    onChoose: (c: MenuChoice) => void;
    onStats: () => void;
    serverUrl: string;
  }): void {
    let bots = 3;
    let difficulty: Difficulty = 'medium';
    let name = opts.defaultName;
    let code = '';
    let mode: 'solo' | 'host' | 'join' | 'spectate' = 'solo';

    const render = () => {
      const needsName = mode !== 'solo';
      const needsCode = mode === 'join' || mode === 'spectate';
      const needsBots = mode === 'solo' || mode === 'host';

      const modeBtn = (m: typeof mode, label: string) =>
        el('button', {
          'aria-pressed': mode === m,
          text: label,
          onClick: () => {
            mode = m;
            render();
          },
        });

      const body: Node[] = [
        el('div', { class: 'seg' }, [
          modeBtn('solo', 'Vs bots'),
          modeBtn('host', 'Host a game'),
          modeBtn('join', 'Join a game'),
          modeBtn('spectate', 'Spectate'),
        ]),
      ];

      if (needsBots) {
        body.push(
          el('div', { class: 'rows' }, [
            el('div', { class: 'row' }, [
              el('label', { text: 'Opponents' }),
              el('div', { class: 'stepper' }, [
                el('button', {
                  text: '−',
                  'aria-label': 'Fewer opponents',
                  onClick: () => {
                    bots = Math.max(mode === 'host' ? 0 : 1, bots - 1);
                    render();
                  },
                }),
                el('span', { class: 'value', text: `${bots} bot${bots === 1 ? '' : 's'}` }),
                el('button', {
                  text: '+',
                  'aria-label': 'More opponents',
                  onClick: () => {
                    bots = Math.min(9, bots + 1);
                    render();
                  },
                }),
              ]),
            ]),
            el('div', { class: 'row' }, [
              el('label', { text: 'Difficulty' }),
              el(
                'div',
                { class: 'seg' },
                DIFFICULTIES.map((d) =>
                  el('button', {
                    'aria-pressed': difficulty === d,
                    text: d,
                    onClick: () => {
                      difficulty = d;
                      render();
                    },
                  }),
                ),
              ),
            ]),
            el('p', { class: 'hint', text: BLURB[difficulty] }),
          ]),
        );
      }

      if (needsCode) {
        const input = el('input', {
          type: 'text',
          placeholder: 'Room code, e.g. K7QM',
          maxlength: 4,
          value: code,
          onInput: (e) => {
            code = (e.target as HTMLInputElement).value.toUpperCase();
            (e.target as HTMLInputElement).value = code;
          },
        });
        body.push(el('div', { class: 'rows' }, [input]));
      }

      if (needsName) {
        body.push(
          el('div', { class: 'rows' }, [
            el('input', {
              type: 'text',
              placeholder: 'Your name',
              maxlength: 16,
              value: name,
              onInput: (e) => {
                name = (e.target as HTMLInputElement).value;
              },
            }),
            el('p', {
              class: 'hint',
              text: `Server: ${opts.serverUrl}. Run "bun run serve" if nobody is hosting yet.`,
            }),
          ]),
        );
      }

      const go = () => {
        if (mode === 'solo') return opts.onChoose({ kind: 'solo', bots, difficulty });
        const trimmed = name.trim() || opts.defaultName;
        if (mode === 'host') {
          return opts.onChoose({ kind: 'host', bots, difficulty, name: trimmed });
        }
        if (code.length !== 4) return;
        opts.onChoose(
          mode === 'join'
            ? { kind: 'join', code, name: trimmed }
            : { kind: 'spectate', code, name: trimmed },
        );
      };

      body.push(
        el('div', { class: 'actions' }, [
          el('button', {
            class: 'primary',
            text: mode === 'solo' ? 'Deal' : mode === 'host' ? 'Create room' : 'Connect',
            onClick: go,
          }),
          el('button', { text: 'Your record', onClick: opts.onStats }),
        ]),
      );

      this.panel(
        el('h1', { html: "UNO <span class='mercy'>No Mercy</span>" }),
        el('p', {
          class: 'sub',
          text: '168 cards. Draw cards stack, 7s swap hands, 0s pass them along, and 25 cards knocks you out.',
        }),
        ...body,
      );
    };

    render();
  }

  // --- lobby ---------------------------------------------------------------

  lobby(opts: {
    code: string;
    players: LobbyPlayer[];
    settings: RoomSettings | null;
    isHost: boolean;
    youId: string;
    error: string | null;
    connecting: boolean;
    onStart: () => void;
    onLeave: () => void;
    onSettings: (s: Partial<RoomSettings>) => void;
  }): void {
    if (opts.connecting) {
      this.panel(
        el('h2', { text: 'Connecting…' }),
        el('p', { class: 'sub', text: 'Reaching the game server.' }),
        el('div', { class: 'actions' }, [el('button', { text: 'Cancel', onClick: opts.onLeave })]),
      );
      return;
    }

    if (opts.error) {
      this.panel(
        el('h2', { text: 'Could not join' }),
        el('p', { class: 'err', text: opts.error }),
        el('div', { class: 'actions' }, [
          el('button', { class: 'primary', text: 'Back to menu', onClick: opts.onLeave }),
        ]),
      );
      return;
    }

    const rows = opts.players.map((p) =>
      el('div', {}, [
        el('span', { text: p.name + (p.id === opts.youId ? '  (you)' : '') }),
        el('span', {
          class: 'tag',
          text: [p.isHost ? 'host' : null, p.connected ? null : 'away'].filter(Boolean).join(' · '),
        }),
      ]),
    );

    const controls: Node[] = [];
    if (opts.isHost && opts.settings) {
      const s = opts.settings;
      controls.push(
        el('div', { class: 'row' }, [
          el('label', { text: 'Bots' }),
          el('div', { class: 'stepper' }, [
            el('button', {
              text: '−',
              onClick: () => opts.onSettings({ botCount: Math.max(0, s.botCount - 1) }),
            }),
            el('span', { class: 'value', text: String(s.botCount) }),
            el('button', {
              text: '+',
              onClick: () => opts.onSettings({ botCount: Math.min(9, s.botCount + 1) }),
            }),
          ]),
        ]),
        el('div', { class: 'row' }, [
          el('label', { text: 'Difficulty' }),
          el(
            'div',
            { class: 'seg' },
            DIFFICULTIES.map((d) =>
              el('button', {
                'aria-pressed': s.difficulty === d,
                text: d,
                onClick: () => opts.onSettings({ difficulty: d }),
              }),
            ),
          ),
        ]),
      );
    }

    this.panel(
      el('h2', { text: 'Waiting room' }),
      el('div', { class: 'code-display', text: opts.code }),
      el('p', {
        class: 'sub',
        text: opts.isHost
          ? 'Read that code out. Everyone else picks "Join a game" and types it.'
          : 'Waiting for the host to deal.',
      }),
      el('div', { class: 'players' }, rows),
      ...controls,
      el('div', { class: 'actions' }, [
        opts.isHost
          ? el('button', {
              class: 'primary',
              text: 'Deal',
              disabled: opts.players.length === 0,
              onClick: opts.onStart,
            })
          : el('button', { text: 'Waiting…', disabled: true }),
        el('button', { text: 'Leave', onClick: opts.onLeave }),
      ]),
    );
  }

  // --- stats ---------------------------------------------------------------

  stats(s: Stats, recent: { won: boolean; difficulty: string; players: number; turns: number; worstHit: number }[], onBack: () => void, onClear: () => void): void {
    const body: Node[] = [];

    if (s.games === 0) {
      body.push(el('p', { class: 'sub', text: 'No games yet. Go and get eliminated a few times.' }));
    } else {
      body.push(
        el('div', { class: 'stat-grid' }, [
          stat('Played', String(s.games)),
          stat('Won', String(s.wins)),
          stat('Win rate', `${Math.round(s.winRate * 100)}%`),
          stat('Avg turns', s.avgTurns.toFixed(0)),
          stat('Worst hit', `+${s.worstHit}`),
        ]),
        el('h2', { text: 'By difficulty' }),
        el(
          'div',
          { class: 'table-list' },
          s.byDifficulty.map((d) =>
            el('div', {}, [
              el('span', { text: d.difficulty }),
              el('span', {
                class: 'muted',
                text: `${d.wins} / ${d.games}  (${d.games ? Math.round((d.wins / d.games) * 100) : 0}%)`,
              }),
            ]),
          ),
        ),
        el('h2', { text: 'Recent' }),
        el(
          'div',
          { class: 'table-list' },
          recent.map((m) =>
            el('div', {}, [
              el('span', { text: `${m.won ? 'Won' : 'Lost'} · ${m.difficulty} · ${m.players}p` }),
              el('span', {
                class: 'muted',
                text: `${m.turns} turns${m.worstHit ? ` · worst +${m.worstHit}` : ''}`,
              }),
            ]),
          ),
        ),
      );
    }

    this.panel(
      el('h2', { text: 'Your record' }),
      ...body,
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', text: 'Back', onClick: onBack }),
        s.games > 0 ? el('button', { class: 'danger', text: 'Clear history', onClick: onClear }) : null,
      ].filter(Boolean) as Node[]),
    );
  }

  // --- game over -----------------------------------------------------------

  gameOver(won: boolean, winnerName: string, onAgain: () => void, onMenu: () => void): void {
    this.panel(
      el('h1', { html: won ? 'You <span class="mercy">win</span>' : `${escapeHtml(winnerName)} wins` }),
      el('p', {
        class: 'sub',
        text: won ? 'Last one standing.' : 'Better luck next hand.',
      }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', text: 'Play again', onClick: onAgain }),
        el('button', { text: 'Menu', onClick: onMenu }),
      ]),
    );
  }
}

function stat(k: string, v: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v', text: v }),
  ]);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The persistent in-game overlay: seats, chips, log, prompt, chat. */
export class Hud {
  private seatNodes = new Map<string, HTMLElement>();
  readonly root: HTMLElement;
  private topbar: HTMLElement;
  private logBox: HTMLElement;
  private promptBox: HTMLElement;
  private cornerBox: HTMLElement;
  private chatBox: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', {});
    this.topbar = el('div', { class: 'topbar' });
    this.logBox = el('div', { class: 'log' });
    this.promptBox = el('div', { class: 'prompt' });
    this.cornerBox = el('div', { class: 'corner' });
    this.root.append(this.topbar, this.logBox, this.promptBox, this.cornerBox);
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  corner(buttons: { label: string; onClick: () => void }[]): void {
    clear(this.cornerBox);
    for (const b of buttons) {
      this.cornerBox.append(el('button', { text: b.label, onClick: b.onClick }));
    }
  }

  /** Reposition seat labels to follow their 3D seats. */
  seats(
    state: RedactedState,
    project: (index: number) => { x: number; y: number } | null,
    limit: number,
  ): void {
    const seen = new Set<string>();
    state.players.forEach((p, i) => {
      seen.add(p.id);
      let node = this.seatNodes.get(p.id);
      if (!node) {
        node = el('div', { class: 'seat' }, [
          el('div', { class: 'name' }),
          el('div', { class: 'count' }),
        ]);
        this.seatNodes.set(p.id, node);
        this.root.append(node);
      }
      const screen = project(i);
      if (!screen) {
        node.style.display = 'none';
        return;
      }
      node.style.display = '';
      node.style.left = `${screen.x}px`;
      node.style.top = `${screen.y}px`;

      const out = p.eliminated || p.finished;
      node.dataset.turn = String(state.players[state.turn]?.id === p.id && !out);
      node.dataset.out = String(out);
      node.dataset.danger = String(!out && p.handCount / limit > 0.8);
      node.querySelector('.name')!.textContent =
        (p.eliminated ? '☠ ' : p.finished ? '★ ' : '') + p.name;
      node.querySelector('.count')!.textContent = out
        ? p.eliminated
          ? 'out'
          : 'finished'
        : `${p.handCount} card${p.handCount === 1 ? '' : 's'}`;
    });

    for (const [id, node] of this.seatNodes) {
      if (!seen.has(id)) {
        node.remove();
        this.seatNodes.delete(id);
      }
    }
  }

  chips(state: RedactedState): void {
    clear(this.topbar);

    const colorChip = el('div', { class: 'chip' });
    if (state.activeColor) {
      colorChip.append(
        el('span', {
          class: 'swatch',
          style: `background:${CARD_COLORS[state.activeColor]}`,
        }),
        document.createTextNode(state.activeColor),
      );
    } else {
      colorChip.textContent = 'no colour yet';
    }
    this.topbar.append(colorChip);

    this.topbar.append(
      el('div', {
        class: 'chip',
        text: state.direction === 1 ? '↻ clockwise' : '↺ anticlockwise',
      }),
      el('div', { class: 'chip', text: `${state.drawPileCount} in deck` }),
    );

    if (state.pendingDraw > 0) {
      this.topbar.append(
        el('div', {
          class: 'chip stack',
          text: `STACK +${state.pendingDraw} · need +${state.stackValue} or higher`,
        }),
      );
    }
  }

  log(entries: LogEntry[]): void {
    clear(this.logBox);
    // Column-reverse in CSS, so the newest entry is appended first.
    for (const e of entries.slice(-8).reverse()) {
      this.logBox.append(el('div', { class: e.tone, text: e.text }));
    }
  }

  prompt(content: {
    label: string;
    colors?: Color[];
    onPick?: (c: Color) => void;
    buttons?: { label: string; onClick: () => void }[];
  }): void {
    clear(this.promptBox);
    this.promptBox.append(el('div', { class: 'label', text: content.label }));

    if (content.colors) {
      this.promptBox.append(
        el(
          'div',
          { class: 'colorpick' },
          content.colors.map((c) =>
            el('button', {
              style: `background:${CARD_COLORS[c]}`,
              'aria-label': c,
              title: c,
              onClick: () => content.onPick?.(c),
            }),
          ),
        ),
      );
    }
    for (const b of content.buttons ?? []) {
      this.promptBox.append(el('button', { class: 'primary', text: b.label, onClick: b.onClick }));
    }
  }

  clearPrompt(): void {
    clear(this.promptBox);
  }

  enableChat(onSend: (text: string) => void): void {
    if (this.chatBox) return;
    const messages = el('div', { class: 'messages' });
    const input = el('input', {
      type: 'text',
      placeholder: 'Say something…',
      maxlength: 200,
      onKeydown: (e) => {
        const ev = e as KeyboardEvent;
        if (ev.key !== 'Enter') return;
        const value = (ev.target as HTMLInputElement).value.trim();
        if (!value) return;
        onSend(value);
        (ev.target as HTMLInputElement).value = '';
      },
    });
    this.chatBox = el('div', { class: 'chat' }, [messages, input]);
    this.root.append(this.chatBox);
  }

  chat(messages: ChatMessage[]): void {
    const box = this.chatBox?.querySelector('.messages');
    if (!box) return;
    clear(box as HTMLElement);
    for (const m of messages.slice(-6)) {
      (box as HTMLElement).append(
        el('div', {}, [el('span', { class: 'who', text: `${m.name}: ` }), m.text]),
      );
    }
  }
}

export { COLORS };
