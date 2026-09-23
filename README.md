# UNO — Show 'Em No Mercy

A browser implementation of **UNO Show 'Em No Mercy**: the 168-card edition with
stackable draw cards, hand-swapping 7s, hand-passing 0s, and the Mercy Rule that
knocks out anyone who reaches 25 cards.

Real 3D cards on a felt table — Three.js, WebGL, actual shadows. Play solo
against bots, or host a room and share a four-character code.

## Quick start

```bash
bun install
bun run dev          # http://localhost:5173
```

Requires [Bun](https://bun.sh) 1.4+ (`curl -fsSL https://bun.sh/install | bash`).

### Playing with friends

One machine runs the server:

```bash
bun run serve                   # ws + http on :4040
```

Everyone opens the client and picks **Host a game** / **Join a game**. The host
reads out the four-character room code. No accounts — nicknames only.

To point the client at another machine, set `VITE_UNO_SERVER`:

```bash
VITE_UNO_SERVER=ws://192.168.1.11:4040 bun run dev
```

### One process, one URL

`bun run build` compiles the client into `packages/web/dist`, and the server
serves it automatically when it exists:

```bash
bun run build && bun run serve  # http://localhost:4040 — game and client
```

That is what the Dockerfile does, so a deployment is a single container.

## Project structure

| Path | Purpose |
|------|---------|
| `packages/engine/` | Rules engine. Pure, **zero dependencies**, no I/O, no clock, no `Math.random` |
| `packages/bots/` | Easy / medium / hard opponents. Read redacted state only |
| `packages/protocol/` | Wire message types, shared by client and server |
| `packages/server/` | Authoritative WebSocket server, and static host for the built client |
| `packages/web/` | The browser client |
| `packages/web/src/game/` | Game controllers — **no Three.js** |
| `packages/web/src/scene/` | Everything WebGL: card art, meshes, layout, animation |
| `packages/web/src/ui/` | The HTML layer: menus, lobby, HUD, chat |
| `config/deck.yml` | Deck composition — **see Task 0 below** |

## Architecture

```
  browser                                     any machine
 ┌──────────────────────────────┐            ┌────────────────────┐
 │ web/scene   Three.js, WebGL  │            │ server             │
 │ web/ui      HTML overlay     │            │   Room = authority │
 │ web/game    controllers  ────┼──websocket─┤                    │
 └──────────────┬───────────────┘  intents   └─────────┬──────────┘
                │                  up,                 │
                │                  redacted            │
                │                  state down          │
                └──────────────► engine ◄──────────────┘
                     reduce()  legalMoves()  redactFor()
```

Three properties hold the whole thing together:

**One reducer.** `reduce(state, action) -> { state, events }` is pure. Every
source of randomness is a seed threaded through `GameState`. Nothing else
mutates a game.

**One legality function.** `legalMoves()` decides what is playable. The client
uses it, bots use it, and the server validates with it. They cannot disagree,
because there is only one implementation.

**One redaction function.** `redactFor(state, viewer)` strips every other hand,
the draw-pile order, and the RNG seed. It is the *only* way state reaches a
client, so it does triple duty: anti-cheat, spectator mode, and bot fairness.

### The renderer is replaceable, and that was proved

This started as a terminal UI. Moving it to Three.js changed **zero lines** of
`engine`, `bots`, `protocol` or `server`, and the game controllers in
`web/src/game/` were copied across untouched — they never knew what was drawing
them. Only the renderer was rewritten.

That is the payoff for keeping game logic free of its presentation, and
`architecture.test.ts` enforces it: controllers may not import Three, and the
engine may not import anything at all.

## ⚠ Task 0 — verify the deck

`config/deck.yml` is the single source of truth for the deck, and the engine
refuses to start unless the counts sum to the declared total.

**Those counts are a reconstruction, not a verified fact.** No public source
publishes an authoritative per-type breakdown — the UNO Wiki, gamerules.com,
unorules.com, unonomercyrules.com, unoregler.com and editioncards.com all state
"168 cards" and stop. The most specific source found confirms only: numbers 0–9
×2 per colour, Draw 2 ×3, Draw 4 ×2, Skip ×3, Skip Everyone ×2 per colour.
Reverse, Discard All and the wild split are inferred to reach 168.

**Count the physical deck and fix that file.** Nothing else needs to change.

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

**Stacking.** The card you play must be **equal or higher** than the draw card
played at you. `+4` onto `+2` is legal; `+2` onto `+4` is not. **Colour is
irrelevant while a stack is live** — a No Mercy rule, not standard UNO. Color
Roulette never joins a stack.

**Mercy Rule.** Reach 25 cards and you are eliminated on the spot, mid-stack if
necessary. Their cards are recycled under the discard pile rather than frozen in
a dead hand — 25+ cards out of circulation can starve the draw pile and stall
the game.

**Winning.** Play your last card, or be the last player standing.

## Environment variables

| Variable | Used by | Default | Notes |
|----------|---------|---------|-------|
| `VITE_UNO_SERVER` | client (build time) | `ws://<host>:4040` | Which server to connect to |
| `PORT` | server | `4040` | Set automatically by most hosts |
| `HOST` | server | `0.0.0.0` | Bind address |
| `UNO_BOT_DELAY_MS` | server | `700` | Bot think-time. Tests set `0` |
| `UNO_STATIC` | server | `packages/web/dist` | Built client to serve; unset to run headless |

## Development

```bash
bun test              # 84 tests
bun run typecheck     # root + web
bun run sim 10000 4   # 10k seeded bot-vs-bot games, invariants checked
bun run bench         # difficulty matchups
```

### The test that actually finds bugs

`bun run sim` plays thousands of seeded games and asserts invariants after
**every single action**. The most valuable is **card conservation**:

```
sum(hands) + drawPile + discardPile === 168, always
```

Nearly every dealing, stacking, hand-swap, Discard All and elimination bug moves
cards between collections, so this one check catches them all. A failure prints
its seed — paste it into a test and debug deterministically.

### Bot difficulty

Verified by `bun run bench` (2v2, seats rotated, 2000 games each):

```
hard   vs easy    58.4%
medium vs easy    54.8%
hard   vs medium  59.0%
```

An early `medium` scored **49.5%** against easy — a coin flip — because it used
the classic UNO heuristic of shedding high-value cards first. **No Mercy has no
points scoring**, so that is worse than useless: it burns the draw cards that are
your only defence, and eating a `+10` puts you ten cards closer to elimination.
Both tiers now hold their draw cards in reserve.

## Gotchas

> **Euler order decides which axis is the table spin.** Three composes XYZ as
> `Rx · Ry · Rz`, so `Rz` is applied to a card first, in its own frame, and
> `Rx = -π/2` lays it flat afterwards. That makes **`rot.z` the in-plane spin**
> and `rot.y` a tilt *out* of the table. Putting seat rotation in `y` stands
> every opponent's cards on their edge — which is exactly what happened.

> **The HUD and the panels need separate layers.** Both used to be appended to
> `#overlay`, and a panel clearing its own container wiped the HUD along with
> it — the game started, but nothing rendered. They are now `#hud-layer` and
> `#screen-layer`.

> **The bottom strip of the viewport belongs to the 3D hand.** Anything docked
> there covers the cards you have to click, so the prompt bar lives under the
> status chips instead.

> **Seat labels must be clamped to the viewport.** Seats at the table edge
> project past the screen bounds on a wide window and vanish.

> **The client never computes authority.** It sends intents and renders what it
> is given. Adding a "quick" client-side legality shortcut re-introduces exactly
> the divergence `legalMoves()` exists to prevent.

> **Bot turns are driven by whoever owns the state.** In a solo game the client
> steps the bots; in a network game the *server* does. A client that also steps
> them races the server and submits duplicate moves.

> **`PCFSoftShadowMap` was removed in three 0.186.** Use `PCFShadowMap`.

## Status

Working: full ruleset, three bot tiers, solo play, LAN multiplayer with room
codes, chat, spectating, reconnect, 3D table with real lighting and shadows,
card animations, match history, and synthesised sound.

Not verified: the Docker image has never been built — Docker was not running on
the machine it was authored on. The single-process mode it wraps *is* verified
(`bun run build && bun run serve`, serving the client and `/health` on one port).
