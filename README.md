# UNO — Show 'Em No Mercy (TUI)

A terminal implementation of **UNO Show 'Em No Mercy**: the 168-card edition with
stackable draw cards, hand-swapping 7s, hand-passing 0s, and the Mercy Rule that
eliminates anyone who reaches 25 cards.

Play solo against bots, or host a room and share a 4-character code with friends
on your network.

```
 ╭───────╮  ╭─────────╮  ╔═════════╗
 │ ☠ Ada │  │ Turing  │  ║ Hopper  ║
 │ —     │  │ 8 cards │  ║ 3 cards ║
 ╰───────╯  ╰─────────╯  ╚═════════╝

                draw       discard
                                       colour  green
              ╭───────╮   ╭───────╮
              │       │   │Ø      │     ↻ clockwise
              │  66   │   │       │
              │       │   │   Ø   │     no stack
              ╰───────╯   ╰───────╯
 ╭─ log ──────────────────────────────────────────────────╮
 │ roulette! Hopper draws until yellow                    │
 │ Turing played green 0                                  │
 │ everyone passed their hand along                       │
 │ Hopper swapped hands with rajat                        │
 ╰────────────────────────────────────────────────────────╯
```

## Quick start

```bash
bun install
bun run play          # menu: solo / host / join / spectate / stats
```

Requires [Bun](https://bun.sh) 1.4+ (`curl -fsSL https://bun.sh/install | bash`).
Nothing else — no Node, no native toolchain, no database server.

### Playing with friends on your network

One machine runs the server:

```bash
bun run serve                         # or: docker compose up -d
```

Everyone (including the host) runs the client, pointed at that machine:

```bash
UNO_SERVER=ws://192.168.1.42:4040 bun run play
```

Pick **host a game**, read out the 4-character room code, and the others pick
**join a game** and type it. No accounts, no signup — nicknames only.

### Sending someone a single file

```bash
bun run build                  # every platform, into dist/
bun run build darwin-arm64     # just one
```

Each output is a self-contained executable with the Bun runtime and OpenTUI's
native library embedded. The recipient needs nothing installed — they download
one file and run it.

## Project structure

| Path | Purpose |
|------|---------|
| `packages/engine/` | Rules engine. Pure, **zero dependencies**, no I/O, no clock, no `Math.random` |
| `packages/bots/` | Easy / medium / hard opponents. Read redacted state only |
| `packages/protocol/` | Wire message types, shared by client and server |
| `packages/server/` | Authoritative websocket server: rooms, chat, reconnect |
| `packages/tui/` | The client. **All OpenTUI imports live in `src/render/`** |
| `config/deck.yml` | Deck composition — **see Task 0 below** |
| `config/game.yml` | House-rule toggles and presentation knobs |
| `scripts/build.ts` | Cross-compiles standalone binaries |
| `Dockerfile` / `docker-compose.yml` | Server image and local LAN run |

## Architecture

```
                    ┌──────────────────────────────┐
  your terminal     │  packages/tui                │
  ───────────────▶  │    render/  ← ONLY OpenTUI   │
                    │    game/    LocalGame        │──┐ solo: bots in-process
                    │             NetworkGame      │  │
                    └──────────────┬───────────────┘  │
                                   │ websocket        │
                                   │ (intents up,     │
                                   │  redacted state  │
                                   │  down)           │
                    ┌──────────────▼───────────────┐  │
                    │  packages/server             │  │
                    │    Room = authority          │  │
                    └──────────────┬───────────────┘  │
                                   │                  │
                    ┌──────────────▼───────────────┐◀─┘
                    │  packages/engine             │
                    │    reduce()  legalMoves()    │
                    │    redactFor()               │
                    └──────────────────────────────┘
```

Three properties hold the whole thing together:

**One reducer.** `reduce(state, action) -> { state, events }` is pure. Every
source of randomness is a seed threaded through `GameState`. Nothing else
mutates a game.

**One legality function.** `legalMoves()` decides what is playable. The UI uses
it to dim cards, bots use it to choose, and the server uses it to validate. They
cannot disagree, because there is only one implementation.

**One redaction function.** `redactFor(state, viewer)` strips every other hand,
the draw-pile order, and the RNG seed. It is the *only* way state reaches a
client, so it does triple duty: anti-cheat, spectator mode, and bot fairness.
A bot that could peek wouldn't be a difficulty level.

### Why the engine has no clock and no `Math.random`

Determinism buys three things at once:

- **Replays are exact.** A replay is just `seed + actions`, a couple of KB. Re-running
  it reproduces the game bit-for-bit, so "it did something weird on turn 40" is
  reproducible rather than a story.
- **Bug reports are reproducible.** A failing simulation seed pastes straight into a test.
- **The bot benchmark is meaningful.** Same seeds, so a difficulty change shows up
  as a real win-rate delta and not as noise.

## ⚠ Task 0 — verify the deck

`config/deck.yml` is the single source of truth for what is in the deck, and the
engine refuses to start unless the counts sum to the declared total.

**The counts in it are a reconstruction, not a verified fact.** No public source
publishes an authoritative per-type breakdown — the UNO Wiki, gamerules.com,
unorules.com, unonomercyrules.com, unoregler.com and editioncards.com all state
"168 cards" and stop. The most specific source found confirms only: numbers 0–9
×2 per colour, Draw 2 ×3, Draw 4 ×2, Skip ×3, Skip Everyone ×2 per colour.
Reverse, Discard All and the wild split are inferred to reach 168.

**Sit down with the physical deck, count it, and fix that file.** Nothing else in
the codebase needs to change. Getting this wrong is invisible for weeks and then
silently poisons every probability the hard bot computes.

## The rules, as implemented

| Card | Effect |
|------|--------|
| `0` | Every player passes their whole hand in the direction of play |
| `7` | Swap hands with a player of your choice |
| Skip | Next player loses their turn |
| Reverse | Direction flips (acts as a Skip with two players) |
| Skip Everyone | Everyone else is skipped; you play again immediately |
| Discard All | Discard every card in your hand matching that card's colour |
| Draw 2 / Draw 4 | Next player draws that many — stackable |
| Wild Draw 6 / Draw 10 | Same, bigger — stackable |
| Wild Reverse Draw 4 | Flips direction **and** stacks +4 |
| Wild Color Roulette | Victim names a colour, then draws until they hit it |

**Stacking.** A draw card may only be played onto a draw card of **equal or lower**
value — i.e. the card you play must be **equal or higher** than the one played at
you. `+4` onto `+2` is legal; `+2` onto `+4` is not. **Colour is irrelevant while a
stack is live** — that is a No Mercy rule, not standard UNO. Color Roulette never
joins a stack.

**Mercy Rule.** Reach 25 cards and you are eliminated on the spot, mid-stack if
necessary. Their cards are recycled under the discard pile rather than frozen in
a dead hand — 25+ cards sitting out of circulation can starve the draw pile and
stall the game.

**Winning.** Play your last card, or be the last player standing.

## Environment variables

| Variable | Used by | Default | Notes |
|----------|---------|---------|-------|
| `UNO_SERVER` | client | `ws://127.0.0.1:4040` | Which server to connect to |
| `UNO_NAME` | client | `$USER` | Your display name |
| `UNO_MUTE` | client | unset | `1` starts muted |
| `UNO_NO_ANIMATION` | client | unset | `1` disables all animation |
| `PORT` | server | `4040` | Set automatically by most hosts |
| `HOST` | server | `0.0.0.0` | Bind address |
| `UNO_BOT_DELAY_MS` | server | `700` | Bot think-time. Tests set `0` |
| `XDG_DATA_HOME` | client | `~` | Where `stats.db` and `replays/` live |

## Keys

**Table** — `←/→` select · `↵` play · `d` draw (or eat the stack) · `r`/`y`/`g`/`b`
choose a colour · `1`–`9` pick a swap target · `l` log · `c` chat · `m` mute ·
`q` quit

**Menu** — `↑/↓` choose · `↵` select · `esc` back · `q` quit

## Development

```bash
bun test          # 107 tests
bun run typecheck
bun run sim 10000 4   # 10k seeded bot-vs-bot games, invariants checked
bun run bench         # difficulty matchups
bun run snapshot 60   # print a rendered mid-game frame
```

### The test that actually finds bugs

`bun run sim` plays thousands of seeded games and asserts invariants after
**every single action**. The most valuable one is **card conservation**:

```
sum(hands) + drawPile + discardPile === 168, always
```

Nearly every dealing, stacking, hand-swap, Discard All and elimination bug moves
cards between collections, so this one check catches them all. Alongside it:
no game exceeds a turn cap (catches stalls), every game ends with exactly one
winner, and the Mercy Rule fires whenever a hand crosses the limit. A failure
prints its seed — paste it into a test and debug deterministically.

### Architecture tests

`packages/tui/test/architecture.test.ts` enforces the structural promises this
README makes, so they cannot rot silently:

- only `render/runtime.ts` imports OpenTUI
- the engine has zero dependencies, imports nothing, does no I/O, and never
  touches `Math.random` / `Date.now` / `new Date`
- bots reference `RedactedState` and never `GameState`
- the server sanitises every name and chat message

### Bot difficulty

Verified by `bun run bench` (2v2, seats rotated, 2000 games each):

```
hard   vs easy    58.4%
medium vs easy    54.8%
hard   vs medium  59.0%
```

The ordering is load-bearing. An early version of `medium` scored **49.5%** against
easy — a coin flip — because it used the classic UNO heuristic of shedding
high-value cards first. **No Mercy has no points scoring**, so that heuristic is
worse than useless: it burns the draw cards that are your only defence, and eating
a `+10` puts you ten cards closer to elimination. Both medium and hard now hold
their draw cards in reserve and spend their cheap, replaceable ones.

## Gotchas

> **OpenTUI is pre-1.0 and moves fast.** It is pinned to an exact version
> (no `^`), and **every `@opentui/*` import lives in a single file**:
> `packages/tui/src/render/runtime.ts`. Screens import hooks and the renderer
> from there. When a breaking change lands, the fix is contained to that one
> file — and `packages/engine` is untouched, because it has no dependencies at
> all. `packages/tui/test/architecture.test.ts` enforces this, so it fails the
> moment an import escapes.
>
> The one unavoidable exception is JSX: `<box>` and `<text>` resolve through
> `jsxImportSource` in `packages/tui/tsconfig.json`. That is one config line,
> so it stays one point of change too.

> **Seat id ≠ connection id.** `GameState` player ids are fixed when the deal
> happens. A reconnecting player must rebind their *connection* to the existing
> *seat*, never change the seat's id — do that and the resumed player can no
> longer see their own hand, because no player in the state matches them.
> `SocketData` keeps `id` and `seatId` separate for exactly this reason.

> **React state in TUI tests needs `act()`.** `t.flush()` renders the frame but
> does not flush React's queued state updates. Without wrapping input in
> `act()`, `captureCharFrame()` returns the *previous* frame and the test
> silently asserts against stale output — it passes when it should fail.
> See the `press()` helper in `packages/tui/test/ui.test.tsx`.

> **Names and chat are stripped of control characters.** They arrive from
> strangers on the network and get printed straight into a terminal. An
> unescaped ESC in a name would let anyone emit ANSI sequences and draw
> anywhere on your screen. `cleanName`/`cleanChat` in `packages/protocol` are a
> security boundary, not cosmetics.

> **The client never computes authority.** It sends intents and renders what it
> is given. Adding a "quick" client-side legality shortcut re-introduces the
> divergence that `legalMoves()` exists to prevent.

> **`flush()` deadlocks during an animation.** In TUI tests, `t.flush()` waits
> for *visual idle*, which by definition never arrives while a tween is
> running — it times out after 20 frames. Use `t.renderOnce()` to step through
> an animation; see `advance()` in `packages/tui/test/animation.test.tsx`.

> **A collapsing spacer does not move anything inside a centred parent.** The
> discard slam lifts the card by collapsing a blank row above it. That is a
> no-op unless the wrapper has a fixed height and bottom alignment — otherwise
> the parent's `alignItems: center` re-centres the shorter box and cancels the
> movement exactly.

> **Never `process.exit()` out of the TUI.** A terminal UI switches on the
> alternate screen, hides the cursor, and enables mouse tracking — modes the
> shell knows nothing about. Exiting without `renderer.destroy()` leaves mouse
> reporting on, and the terminal then fills with raw SGR reports
> (`35;113;45M35;112;45M…`) until you run `reset`. All exits go through
> `quit()` in `packages/tui/src/render/shutdown.ts`, which also installs
> handlers for signals and crashes and writes the restore sequences directly
> as a backstop. `packages/tui/test/shutdown.test.ts` fails if a bare
> `process.exit(` reappears in `main.tsx`.

> **Bot turns are driven by whoever owns the state.** In a solo game the client
> steps the bots; in a network game the *server* does. The table checks
> `game instanceof LocalGame` before starting a bot timer — without that, a
> networked client would race the server and submit duplicate bot moves.

## Animation

Driven by OpenTUI's timeline engine, which runs off the renderer's own frame
callback — so animation stays synced to real frames and never queues up faster
than the terminal can draw.

| Effect | Where |
|--------|-------|
| Staggered deal — cards flip face-up left to right | opening hand |
| Slam — bright double border and a one-row drop | discard pile, every card played |
| Pulse — the stack warning throbs while a stack is live | centre panel |
| Pulse — an opponent's border reddens past 80% of the hand limit | opponent strip |
| Flash — a red burst the moment someone is eliminated | opponent strip |

`UNO_NO_ANIMATION=1` turns all of it off. A test asserts the settled animated
frame is **byte-identical** to the un-animated frame, so animation can only
ever be decoration — it cannot change what the table says.

## Status

Working: full ruleset, three bot tiers, solo play, LAN multiplayer with room
codes, chat, spectating, reconnect, match history, replay capture, sound, and
animation.

Not yet done: a replay *viewer* — replays are recorded and reload correctly
(with an exact round-trip test), but there is no step-through UI yet.

The `Dockerfile` and `docker-compose.yml` are written but **have not been built**
— Docker was not running on the machine they were authored on. The server they
wrap is verified working standalone (`bun run serve`, `/health` returns `200`).
