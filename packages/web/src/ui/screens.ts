/**
 * The HTML layer: menus, lobby, stats, and the in-game HUD.
 *
 * Three draws the table; everything that is text lives here as DOM, because
 * text rendered into WebGL is worse at every one of the things text needs to
 * be good at - selection, accessibility, reflow and crispness.
 */

import { COLORS, type Color, type RedactedState } from '@uno/engine';
import type { Difficulty } from '@uno/bots';
import {
  HOUSE_RULE_LIMITS,
  TURN_SECONDS,
  type BotSpeed,
  type ChatMessage,
  type HouseRules,
  type LobbyPlayer,
  type RoomSettings,
  type TurnSeconds,
} from '@uno/protocol';
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
  | { kind: 'host'; bots: number; difficulty: Difficulty; name: string; seats: number }
  | { kind: 'join'; code: string; name: string }
  | { kind: 'spectate'; code: string; name: string };

export class Screens {
  /**
   * Whether the house-rules disclosure is open.
   *
   * Held on the instance because the lobby is rebuilt from scratch every time
   * the server broadcasts settings - which is on every toggle. Without this,
   * changing a rule collapses the panel you are working in.
   */
  private advancedOpen = false;

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
    /** False on a static host with no reachable game server. */
    multiplayer: boolean;
  }): void {
    let bots = 3;
    // Hosting starts with NO bots. You are opening a table for people; bots
    // are something you add afterwards if seats go unfilled.
    let hostSeats = 4;
    let difficulty: Difficulty = 'medium';
    let name = opts.defaultName;
    let code = '';
    let mode: 'solo' | 'host' | 'join' | 'spectate' = 'solo';

    const render = () => {
      const needsName = mode !== 'solo';
      const needsCode = mode === 'join' || mode === 'spectate';
      // Bot count and difficulty only make sense when you ARE the opposition
      // setup - i.e. a solo game. Hosting configures those in the lobby, once
      // you can see who actually turned up.
      const needsBots = mode === 'solo';
      const needsSeats = mode === 'host';

      const online = (m: typeof mode) => m !== 'solo';

      /**
       * Each mode is a card that says what it does.
       *
       * The previous row of four bare words made the reader guess at the
       * difference between "Host" and "Join", and gave a disabled button no
       * way to explain itself.
       */
      const modeCard = (m: typeof mode, label: string, blurb: string) => {
        // Online modes stay VISIBLE but disabled when no server is reachable.
        // Hiding them just raises the question "where did they go?".
        const blocked = online(m) && !opts.multiplayer;
        return el(
          'button',
          {
            class: 'mode-card',
            'aria-pressed': mode === m,
            disabled: blocked,
            title: blocked ? 'Needs a game server — see the note below' : undefined,
            onClick: () => {
              if (blocked) return;
              mode = m;
              render();
            },
          },
          [
            el('span', { class: 'mode-name', text: label }),
            el('span', { class: 'mode-blurb', text: blurb }),
          ],
        );
      };

      const body: Node[] = [
        el('div', { class: 'mode-grid' }, [
          modeCard('solo', 'Play vs bots', 'Offline. Start immediately.'),
          modeCard('host', 'Host a game', 'Open a table, share a code.'),
          modeCard('join', 'Join a game', "Enter a friend's code."),
          modeCard('spectate', 'Spectate', 'Watch without playing.'),
        ]),
      ];

      if (!opts.multiplayer) {
        body.push(
          el('div', { class: 'notice' }, [
            el('strong', { text: 'Online play is off on this build' }),
            el('span', {
              text: 'This page is hosted on GitHub Pages, which serves files but cannot run a game server — so there is nothing for Host, Join or Spectate to connect to. Playing against bots works fully.',
            }),
            el('span', {
              class: 'how',
              text: 'To play with friends: clone the repo and run "bun run serve", or deploy the included render.yaml for a single URL that does both.',
            }),
          ]),
        );
      }

      if (needsBots) {
        body.push(
          el('div', { class: 'section' }, [
            el('h3', { class: 'section-title', text: 'Game setup' }),
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

      if (needsSeats) {
        body.push(
          el('div', { class: 'section' }, [
            el('h3', { class: 'section-title', text: 'Your table' }),
            el('div', { class: 'row' }, [
              el('label', { text: 'Table size' }),
              el('div', { class: 'stepper' }, [
                el('button', {
                  text: '−',
                  'aria-label': 'Smaller table',
                  onClick: () => {
                    hostSeats = Math.max(2, hostSeats - 1);
                    render();
                  },
                }),
                el('span', { class: 'value', text: `${hostSeats} seats` }),
                el('button', {
                  text: '+',
                  'aria-label': 'Bigger table',
                  onClick: () => {
                    hostSeats = Math.min(10, hostSeats + 1);
                    render();
                  },
                }),
              ]),
            ]),
            el('p', {
              class: 'hint',
              text: 'You get a room code to share. Add bots later if seats go unfilled.',
            }),
          ]),
        );
      }

      if (needsCode) {
        const input = el('input', {
          type: 'text',
          class: 'code-input',
          placeholder: 'K7QM',
          maxlength: 4,
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          value: code,
          onInput: (e) => {
            code = (e.target as HTMLInputElement).value.toUpperCase();
            (e.target as HTMLInputElement).value = code;
          },
        });
        body.push(
          el('div', { class: 'section' }, [
            el('h3', { class: 'section-title', text: 'Room code' }),
            input,
          ]),
        );
      }

      if (needsName) {
        body.push(
          el('div', { class: 'section' }, [
            el('h3', { class: 'section-title', text: 'You' }),
            el('input', {
              type: 'text',
              placeholder: 'Your name',
              maxlength: 16,
              value: name,
              onInput: (e) => {
                name = (e.target as HTMLInputElement).value;
              },
            }),
            el('p', { class: 'hint', text: `Server: ${opts.serverUrl}` }),
          ]),
        );
      }

      const go = () => {
        if (mode === 'solo') return opts.onChoose({ kind: 'solo', bots, difficulty });
        const trimmed = name.trim() || opts.defaultName;
        if (mode === 'host') {
          // Zero bots: the host opens a table for people, then tops it up.
          return opts.onChoose({
            kind: 'host',
            bots: 0,
            difficulty,
            name: trimmed,
            seats: hostSeats,
          });
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
        el('header', { class: 'masthead' }, [
          el('h1', { html: "UNO <span class='mercy'>No Mercy</span>" }),
          el('p', {
            class: 'sub',
            text: '168 cards. Draw cards stack, 7s swap hands, 0s pass them along, and 25 cards knocks you out.',
          }),
        ]),
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

    const humans = opts.players.filter((p) => !p.isBot);
    const seats = opts.settings?.maxPlayers ?? 6;
    const rows = opts.players.map((p) =>
      el('div', {}, [
        el('span', { text: p.name + (p.id === opts.youId ? '  (you)' : '') }),
        el('span', {
          class: 'tag',
          text: [p.isBot ? 'bot' : null, p.isHost ? 'host' : null, p.connected ? null : 'away']
            .filter(Boolean)
            .join(' · '),
        }),
      ]),
    );
    // Show the empty seats too, so "who else is coming" is visible at a glance.
    for (let i = humans.length; i < seats; i++) {
      rows.push(
        el('div', { class: 'empty-seat' }, [
          el('span', { text: 'empty seat' }),
          el('span', { class: 'tag', text: 'waiting' }),
        ]),
      );
    }

    const controls: Node[] = [];
    if (opts.isHost && opts.settings) {
      const s = opts.settings;
      controls.push(
        el('div', { class: 'row' }, [
          el('label', { text: 'Fill seats with bots' }),
          el('div', { class: 'stepper' }, [
            el('button', {
              text: '−',
              onClick: () => opts.onSettings({ botCount: Math.max(0, s.botCount - 1) }),
            }),
            el('span', {
              class: 'value',
              text: s.botCount === 0 ? 'none' : `${s.botCount} bot${s.botCount === 1 ? '' : 's'}`,
            }),
            el('button', {
              text: '+',
              onClick: () => opts.onSettings({ botCount: Math.min(9, s.botCount + 1) }),
            }),
          ]),
        ]),
      );
      // Difficulty is meaningless with no bots on the table.
      if (s.botCount > 0) {
        controls.push(
          el('div', { class: 'row' }, [
            el('label', { text: 'Bot difficulty' }),
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
    }

    const rules = opts.settings?.rules;
    if (rules) {
      if (opts.isHost) {
        controls.push(
          houseRuleControls(
            opts.settings!,
            this.advancedOpen,
            (open) => {
              this.advancedOpen = open;
            },
            (patch) => opts.onSettings({ rules: { ...rules, ...patch } }),
            (patch) => opts.onSettings(patch),
          ),
        );
      } else {
        // Joiners cannot change the rules but must be able to see them.
        controls.push(el('p', { class: 'hint', text: `House rules: ${houseRuleSummary(rules)}` }));
      }
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
      el('p', {
        class: 'hint',
        text: `${humans.length} of ${seats} seat${seats === 1 ? '' : 's'} taken`,
      }),
      el('div', { class: 'players' }, rows),
      ...controls,
      el('div', { class: 'actions' }, [
        opts.isHost
          ? el('button', {
              class: 'primary',
              // One human and no bots is not a game; say so on the button.
              text:
                humans.length + (opts.settings?.botCount ?? 0) < 2
                  ? 'Waiting for players…'
                  : 'Deal',
              disabled: humans.length + (opts.settings?.botCount ?? 0) < 2,
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

/**
 * House-rule controls for the host.
 *
 * Collapsed by default: most tables play the standard rules, and a wall of
 * toggles between "create room" and "deal" is noise for them.
 */
function houseRuleControls(
  settings: RoomSettings,
  open: boolean,
  onToggleOpen: (open: boolean) => void,
  onRules: (patch: Partial<HouseRules>) => void,
  onSettings: (patch: Partial<RoomSettings>) => void,
): HTMLElement {
  const rules = settings.rules;

  const stepper = (
    label: string,
    value: number,
    suffix: string,
    lo: number,
    hi: number,
    key: 'startingHand' | 'handLimit',
  ) =>
    el('div', { class: 'row' }, [
      el('label', { text: label }),
      el('div', { class: 'stepper' }, [
        el('button', {
          text: '−',
          'aria-label': `Decrease ${label}`,
          disabled: value <= lo,
          onClick: () => onRules({ [key]: value - 1 } as Partial<HouseRules>),
        }),
        el('span', { class: 'value', text: `${value} ${suffix}` }),
        el('button', {
          text: '+',
          'aria-label': `Increase ${label}`,
          disabled: value >= hi,
          onClick: () => onRules({ [key]: value + 1 } as Partial<HouseRules>),
        }),
      ]),
    ]);

  const toggle = (label: string, hint: string, value: boolean, onFlip: () => void) =>
    el('div', { class: 'row toggle-row' }, [
      el('div', { class: 'toggle-label' }, [
        el('label', { text: label }),
        el('span', { class: 'hint', text: hint }),
      ]),
      el('button', {
        class: value ? 'toggle on' : 'toggle',
        'aria-pressed': value,
        text: value ? 'On' : 'Off',
        onClick: onFlip,
      }),
    ]);

  const choice = <T extends string | number>(
    label: string,
    hint: string,
    options: { value: T; label: string }[],
    current: T,
    onPick: (v: T) => void,
  ) =>
    el('div', { class: 'row toggle-row' }, [
      el('div', { class: 'toggle-label' }, [
        el('label', { text: label }),
        el('span', { class: 'hint', text: hint }),
      ]),
      el(
        'div',
        { class: 'seg' },
        options.map((o) =>
          el('button', {
            'aria-pressed': current === o.value,
            text: o.label,
            onClick: () => onPick(o.value),
          }),
        ),
      ),
    ]);

  const group = (title: string, children: Node[]) =>
    el('div', { class: 'rule-group' }, [el('h3', { text: title }), ...children]);

  const body = el('div', { class: 'advanced-body' }, [
    group('The deal', [
      stepper(
        'Starting hand',
        rules.startingHand,
        'cards',
        HOUSE_RULE_LIMITS.startingHand.min,
        HOUSE_RULE_LIMITS.startingHand.max,
        'startingHand',
      ),
      stepper(
        'Mercy Rule at',
        rules.handLimit,
        'cards',
        Math.max(HOUSE_RULE_LIMITS.handLimit.min, rules.startingHand + 3),
        HOUSE_RULE_LIMITS.handLimit.max,
        'handLimit',
      ),
    ]),

    group('Mechanics', [
      toggle('Stacking', 'Answer a draw card instead of eating it', rules.stacking, () =>
        onRules({ stacking: !rules.stacking }),
      ),
      ...(rules.stacking
        ? [
            choice(
              'Stack rule',
              rules.stackMode === 'escalating'
                ? 'Must play equal or higher — the real No Mercy rule'
                : 'Any draw card answers any other — far more survivable',
              [
                { value: 'escalating' as const, label: 'Escalating' },
                { value: 'any' as const, label: 'Any' },
              ],
              rules.stackMode,
              (v) => onRules({ stackMode: v }),
            ),
          ]
        : []),
      toggle('7s swap hands', "Play a 7, take someone else's hand", rules.sevenSwap, () =>
        onRules({ sevenSwap: !rules.sevenSwap }),
      ),
      toggle('0s pass hands', 'Play a 0, everyone shifts their hand along', rules.zeroPass, () =>
        onRules({ zeroPass: !rules.zeroPass }),
      ),
      toggle(
        'Draw until playable',
        'Keep drawing until you get something you can play',
        rules.drawUntilPlayable,
        () => onRules({ drawUntilPlayable: !rules.drawUntilPlayable }),
      ),
      toggle(
        'Force play',
        'A card you draw is played for you if it is playable',
        rules.forcePlay,
        () => onRules({ forcePlay: !rules.forcePlay }),
      ),
    ]),

    group('Table', [
      choice(
        'Bot speed',
        'How long bots pause before playing',
        [
          { value: 'fast' as const, label: 'Fast' },
          { value: 'normal' as const, label: 'Normal' },
          { value: 'slow' as const, label: 'Slow' },
        ],
        settings.botSpeed,
        (v: BotSpeed) => onSettings({ botSpeed: v }),
      ),
      choice(
        'Turn timer',
        settings.turnSeconds === 0
          ? 'No limit — one player walking away freezes the table'
          : `Auto-plays for anyone who takes over ${settings.turnSeconds}s`,
        TURN_SECONDS.map((t) => ({ value: t, label: t === 0 ? 'Off' : `${t}s` })),
        settings.turnSeconds,
        (v: TurnSeconds) => onSettings({ turnSeconds: v }),
      ),
      toggle(
        'Allow spectators',
        'Anyone with the code can watch without playing',
        settings.allowSpectators,
        () => onSettings({ allowSpectators: !settings.allowSpectators }),
      ),
    ]),
  ]);

  const panel = el('details', { class: 'advanced' }, [
    el('summary', {}, [
      el('span', { class: 'adv-title', text: 'Advanced setup' }),
      // Showing the current values makes this read as a settings row you can
      // act on, rather than a collapsed heading that might be anything.
      el('span', { class: 'adv-summary', text: houseRuleSummary(rules) }),
    ]),
    body,
  ]) as HTMLDetailsElement;
  panel.open = open;
  panel.addEventListener('toggle', () => onToggleOpen(panel.open));
  return panel;
}

/** One-line summary of any non-standard rules, for players who cannot edit. */
export function houseRuleSummary(rules: HouseRules): string {
  const parts: string[] = [`${rules.startingHand} cards`, `out at ${rules.handLimit}`];
  if (!rules.stacking) parts.push('no stacking');
  else if (rules.stackMode === 'any') parts.push('any-card stacking');
  if (!rules.sevenSwap) parts.push('no 7-swaps');
  if (!rules.zeroPass) parts.push('no 0-passes');
  if (rules.drawUntilPlayable) parts.push('draw until playable');
  if (rules.forcePlay) parts.push('force play');
  return parts.join(' · ');
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
    project: (
      index: number,
      size: { width: number; height: number },
    ) => { x: number; y: number } | null,
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
      // Measured before positioning, so the caller can clamp by real size.
      const box = node.getBoundingClientRect();
      const screen = project(i, { width: box.width || 96, height: box.height || 44 });
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
      // Least essential of the three; hidden on phones so the row fits.
      el('div', { class: 'chip secondary', text: `${state.drawPileCount} in deck` }),
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
