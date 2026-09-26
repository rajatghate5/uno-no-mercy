# No Mercy

A browser card game: 168 cards, stackable draw cards, hand-swapping 7s,
hand-passing 0s, and a mercy rule that knocks out anyone who reaches 25 cards.

An unofficial, non-commercial fan implementation of the rules published in
Mattel's HWV18 instruction sheet. Not affiliated with, endorsed by or
sponsored by Mattel. No trademarked name or artwork is reproduced here: the
rules are cited as a source, and every card face in this repo is drawn from
scratch in `packages/web/src/scene/cardArt.ts`.

Real 3D cards on a felt table — Three.js, WebGL, actual shadows. Play solo
against bots, or host a room and share a four-character code.

## Play it

### → **https://rajatghate5.github.io/no-mercy/**

Nothing to install, nothing to run. It opens in any modern browser, desktop or
phone, and starts immediately.

Online play works from that link: the page is static, but it is built with the
address of a game server baked in, so Host / Join / Spectate reach
<https://no-mercy-5cg1.onrender.com> behind the scenes. That server is also
playable directly, and serves the same client from its own URL.

> **The server sleeps.** It is on Render's free plan, which idles a service
> after 15 minutes. The first person to open a room after a quiet spell waits
> roughly 50 seconds for it to wake; everyone after that is immediate. Solo
> play never touches it and is always instant.

Leave the `UNO_SERVER` variable unset in a fork and the same build becomes
solo-only, with the online modes visibly disabled and the reason on screen
rather than four buttons where three time out.

## Running it yourself

You only need [Bun](https://bun.sh) 1.4+ to *develop* or *host* the game.
Playing it needs neither Bun nor a clone — just the link above.

```bash
curl -fsSL https://bun.sh/install | bash   # once
bun install
bun run dev                                # http://localhost:5173
```

### Hosting

**Host a game** gives you a room code and an empty table. People join with the
code; bots are an optional top-up for seats nobody takes, not the default.

The lobby's **Advanced setup** panel changes the game before you deal:

**The deal**

| Setting | Default | Range |
|---|---|---|
| Starting hand | 7 cards | 3–12 |
| Mercy Rule at | 25 cards | 10–60, always above the deal |

**Mechanics**

| Setting | Default | Effect |
|---|---|---|
| Stacking | on | Answer a draw card instead of eating it |
| Stack rule | last card | What your draw card has to beat. **Last card** is what the instruction sheet says. **Running total** is unorules.com's reading — stacks die after two cards, because two in you are already past `+10`. **Any** lets a `+2` answer a `+10`, which is not a rule anywhere but makes stacks survivable |
| 7s swap hands | on | Play a 7, take someone's hand |
| 0s pass hands | on | Play a 0, everyone shifts along |
| Call UNO | on | One card left? Say it, or an opponent can catch you for 2. See [Calling UNO](#calling-uno) |
| Draw until playable | **on** | Keep drawing until something matches, rather than drawing one and passing. A printed rule, not a house rule |
| Force play | **on** | A card you draw is played for you if it is playable. The same printed rule, second half |

**Table**

| Setting | Default | Effect |
|---|---|---|
| Bot speed | normal | fast 300ms / normal 700ms / slow 1400ms. Presentation only — changes no outcome |
| Turn timer | off | 15/30/60s. Auto-plays for anyone who stalls, using the bot brain — so a player who walks away loses tempo, not the game |
| Allow spectators | on | Whether people with the code can watch without playing |

#### Calling UNO

> "The moment you only have 1 card in your hand, you must yell UNO… However, if
> someone catches you and calls out UNO before you (and before the next player
> begins their turn), then you must draw 2 cards!"

The printed window — *before the next player begins their turn* — is no window
at all at a digital table. It would shut before a human could reach the mouse,
which turns the rule into a tax on reaction time rather than a race.

So the window is held open until the at-risk player's **own next turn**, and
bots wait two seconds before pouncing on a human. Everything else is intact:
nothing happens unless somebody actually catches you.

Bots never forget their own. Catching *you* is where difficulty shows — easy
misses it three times in four, hard never does.

Everything is re-clamped server-side on every change — the values arrive from a
client and are not trusted. A Mercy limit at or below the starting hand would
eliminate the whole table on the first turn, so the server forces it higher.
Players who join see the rules as a read-only summary.

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

## Packages

A Bun workspace of five packages. They are never published — the scope is a
local name — but the boundaries between them are real and enforced by tests.

| Package | Path | Depends on | Purpose |
|---------|------|-----------|---------|
| `@mercy/engine` | `packages/engine/` | **nothing** | Rules. Pure: no I/O, no clock, no `Math.random` |
| `@mercy/bots` | `packages/bots/` | engine | Easy / medium / hard opponents. Read redacted state only |
| `@mercy/protocol` | `packages/protocol/` | engine, bots | Wire message types, shared by client and server |
| `@mercy/server` | `packages/server/` | engine, bots, protocol | Authoritative WebSocket server; also serves the built client |
| `@mercy/web` | `packages/web/` | engine, bots, protocol, **three** | The browser client |

```
engine ◄── bots ◄── protocol ◄── server
   ▲         ▲         ▲
   └─────────┴─────────┴──────── web  + three.js
```

**Three.js is the only external runtime dependency in the whole repo.**
Everything else is workspace-internal, and `engine` has neither kind — it is
reachable from every other package and reaches nothing itself, which is what
makes it testable by exhaustive simulation.

The arrows only point one way, and `architecture.test.ts` keeps it that way:
the engine may not import anything at all, and the game controllers in
`web/src/game/` may not import Three. That rule is what let the renderer be
swapped from a terminal UI to WebGL without touching a line of game logic.

Inside the client:

| Path | Purpose |
|------|---------|
| `packages/web/src/game/` | Game controllers — **no Three.js** |
| `packages/web/src/scene/` | Everything WebGL: card art, meshes, layout, animation |
| `packages/web/src/ui/` | The HTML layer: menus, lobby, HUD, chat |
| `config/deck.yml` | Deck composition — the single source of truth |

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

## The deck

168 cards, **22 distinct card types**, taken from Mattel's own instruction
sheet for HWV18:
[service.mattel.com/instruction_sheets/HVW18-Eng.pdf](https://service.mattel.com/instruction_sheets/HVW18-Eng.pdf)
(the typo in the filename — HVW, not HWV — is Mattel's).

**Per colour (38 × 4 = 152)**

| Card | Per colour | In deck |
|------|-----------:|--------:|
| `0`–`9` | 2 each | 80 |
| Draw 2 | 3 | 12 |
| Skip | 3 | 12 |
| Reverse | 3 | 12 |
| Draw 4 (coloured) | 3 | 12 |
| Skip Everyone | 3 | 12 |
| Discard All | 3 | 12 |

**Wilds (4 types × 4 = 16)** — Wild Draw 6, Wild Draw 10,
Wild Reverse Draw 4, Wild Color Roulette.

Three things worth knowing:

- **There are two `0`s per colour**, like every other rank. Standard UNO has
  one; No Mercy drops that, which matters because the `0` is the card that
  makes everyone pass their whole hand along.
- **There is no plain Wild.** Every wild in the deck has a penalty attached —
  the instruction sheet's own scoring table names exactly four wild cards.
- **There is no plain Wild Draw 4** either. No Mercy has a *coloured* +4 in
  each suit and a *Wild Reverse* Draw 4, but no colourless plain +4.

`config/deck.yml` restates this with the sourcing and the reasoning; the values
live in `DEFAULT_DECK_SPEC`. Run `bun run deck` to print the composition.

> **Do not "fix" these counts against a rules-aggregator site.** Several of
> them contradict each other, and two publish 168-card breakdowns whose own
> numbers do not add up to 168.
>
> Three different wrong specs have been in this repo, and **every one of them
> summed to exactly 168** — so nothing ever crashed and every test passed. A
> total can never verify a deck. `rules.test.ts` asserts every per-type count,
> which is the only check that has ever caught one of these.

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
| Wild Reverse Draw 4 | Flips direction **and** stacks +4 — but see below |
| Wild Color Roulette | Victim names a colour, then draws until they hit it |

**Drawing is not "draw one and pass".** *"If you DO NOT HAVE a matching card,
you MUST draw cards from the Draw Pile UNTIL YOU DRAW A CARD YOU CAN PLAY.
Then, play that card."* Both halves of that sentence are printed rules, and
both are on by default. Turning them off gives you classic UNO.

**Stacking.** The card you play must be **equal or higher** than the draw card
played at you. `+4` onto `+2` is legal; `+2` onto `+4` is not. **Colour is
irrelevant while a stack is live** — a No Mercy rule, not standard UNO. Color
Roulette never joins a stack.

**Wild Reverse Draw 4 backfires in a two-player game.** *"With just two players
this card skips the other player and makes YOU draw 4 cards! You may use the
stacking rule to send the penalty back."* So the turn does not move on: you are
now facing your own +4, and only a `+4`-or-higher sends it across the table.

**Wild Color Roulette is named by the victim, not by you.** Playing it gives
you no colour choice at all — the next player names the colour, digs for it,
and that colour is what is left in play. Wilds do not count as a match.

**Mercy Rule.** Reach 25 cards and you are eliminated on the spot, mid-stack if
necessary. Their cards are recycled under the discard pile rather than frozen in
a dead hand — 25+ cards out of circulation can starve the draw pile and stall
the game. (The sheet sets them aside until the next reshuffle; recycling them
under the discard reaches the same place and keeps card conservation exact.)

**Winning.** Play your last card, or be the last player standing.

## Deploying

### GitHub Pages

`.github/workflows/pages.yml` builds and publishes on every push to `main`.
Enable it once: **Settings → Pages → Source → GitHub Actions**. The site lands
at `https://<user>.github.io/<repo>/` — for this repo,
<https://rajatghate5.github.io/no-mercy/>.

**Pages serves static files only — it cannot run the WebSocket server.** On its
own the workflow therefore ships the solo-vs-bots game, and the client disables
the online modes rather than offering four options where three time out. Point
it at a server with `UNO_SERVER` (below) and the same build gains multiplayer
without Pages running anything.

### Adding multiplayer to a Pages deploy

Host the server anywhere that allows long-lived connections (Render, Fly,
Railway — the Dockerfile runs as-is), then set a repository variable
**`UNO_SERVER`** to its URL under Settings → Secrets and variables → Actions →
Variables. The next deploy picks it up. This repo's is
`wss://no-mercy-5cg1.onrender.com/`.

> The variable alone changes nothing. The address is baked into the bundle at
> **build** time, not read at runtime, so a site already published keeps
> whatever it was built with until the workflow runs again — Actions → Deploy
> to GitHub Pages → Run workflow.

> It **must** be `wss://`, not `ws://`. A page served over HTTPS cannot open an
> insecure WebSocket — the browser blocks it as mixed content — so a `ws://`
> address on Pages is the same as no server at all. `resolveServer()` treats it
> that way on purpose, and `serverUrl.test.ts` pins the behaviour.

> **Only point `UNO_SERVER` at an address that will outlive the build.** It is
> baked in at build time, so a `cloudflared tunnel --url` address — which
> changes every restart and dies with the terminal — leaves the *published*
> site permanently dialling a host that no longer exists. Every visitor then
> gets a connection error on Host and Join, long after the tunnel is gone.
> A tunnel is fine for testing from `bun run dev`; it is not a deploy target.
> Leave the variable unset for a solo-only Pages site, which fails honestly.

### One container — game + client on one URL (recommended for multiplayer)

`render.yaml` is a Render Blueprint: **New → Blueprint → point at this repo**.
One service runs the game server and serves the client, so multiplayer works on
a single URL with nothing else to configure.

The same image runs anywhere that takes a Dockerfile (Fly, Railway, a VPS):

```bash
docker compose up -d      # http://localhost:4040
```

The Docker build sets `VITE_UNO_SAME_ORIGIN=1`, which tells the client its
socket lives at the page's own origin. Without that flag an HTTPS deploy is
indistinguishable from a static host and the client disables multiplayer —
see `resolveServer()`.

> Render's free plan sleeps after 15 minutes idle, so the first visitor waits
> ~50s for it to wake.

## Environment variables

| Variable | Used by | Default | Notes |
|----------|---------|---------|-------|
| `VITE_UNO_SERVER` | client (build time) | — | Explicit server address. Must be `wss://` if the page is served over HTTPS |
| `VITE_UNO_SAME_ORIGIN` | client (build time) | — | `1` when the game server also serves the page (set by the Dockerfile) |
| `BASE_PATH` | client (build time) | `/` | Sub-path for project-site hosting, e.g. `/no-mercy/` |
| `PORT` | server | `4040` | Set automatically by most hosts |
| `HOST` | server | `0.0.0.0` | Bind address |
| `UNO_BOT_DELAY_MS` | server | `700` | Bot think-time. Tests set `0` |
| `UNO_STATIC` | server | `packages/web/dist` | Built client to serve; unset to run headless |

## Development

```bash
bun test              # 177 tests
bun run typecheck     # root + web
bun run sim 10000 4   # 10k seeded bot-vs-bot games, invariants checked
bun run bench         # difficulty matchups
bun run deck          # print the deck composition
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
hard   vs easy    67.0%
medium vs easy    61.2%
hard   vs medium  54.4%
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

> **A phone has no hover, so one tap cannot both preview and commit.** The
> desktop hand lifts a card on hover and plays it on click; on a touch device
> the first tap raises the card and a second tap on the *same* card plays it.
> Without that, a mis-tap costs a turn instead of a correction.

> **Size the hand from the camera frustum, not a constant.** The portrait
> camera sits ~1.3 world units closer than the landscape one, so a hardcoded
> distance made the fan wider than the viewport and sliced the end cards off
> the screen. `handWidthBudget()` measures the live camera every update.

> **Clamp HUD labels by their measured width.** A fixed inset that looked right
> on a phone let the wider seat chips hang off both edges of a tablet.

> **Bot turns are driven by whoever owns the state.** In a solo game the client
> steps the bots; in a network game the *server* does. A client that also steps
> them races the server and submits duplicate moves.

> **`PCFSoftShadowMap` was removed in three 0.186.** Use `PCFShadowMap`.

> **A UI accent may not be readable as a suit.** The interface accent was
> `#c9a227` — hue 46 — and the yellow card is `#f2b705`, hue 45. They were the
> same colour, so every "this is live, this is your turn, this is selected"
> mark was painted in the colour the game already uses to mean *this card is
> yellow*; danger sat 15° off the red card. Four fixed suit hues eat most of
> the wheel: claiming 30° either side leaves gaps of 35° (lime), 14° (cyan)
> and 78° (violet), and overruns orange outright. So an accent must either
> have **chroma under 10%**, or sit **more than 55° clear** of 352/45/140/214
> — which only violet does. Bone at 7% chroma is the current answer. Brass
> survives as the *material* the one filled button is struck from: it may be
> an object, never a signal.

> **Reading pixels back from the WebGL canvas in-page returns an empty
> buffer.** Without `preserveDrawingBuffer`, `drawImage(canvas, …)` after the
> frame is presented gives black. A check written that way reported zero
> problems at every viewport and was used to declare a bug fixed that was not.
> Measure from a real screenshot instead — and discriminate cards from felt
> while you are there, because a naive brightness threshold counts the lit
> table: cards genuinely clipped show peak channel 231 at the edge, a clean
> frame shows 56.

> **Anything lying on the felt needs clearance before you tilt it.** A card's
> corner is 0.901 units from its centre, so a 0.13 rad rock drops it 0.117 —
> and the attract cards rested at y = 0.03, putting that corner *under* the
> table. The felt is a plane, so it clips in a dead-straight line and reads as
> the card having been sliced off rather than occluded. Clearance must exceed
> `half-diagonal × sin(max tilt)`, not merely be non-zero.

> **A ring of cards must be sized to the lamp, not to the camera.** The
> visible felt is a trapezoid — at 1440×900 it runs from z = +4.10 at the
> bottom of the screen back to −11.28, 11.1 units wide at the near edge and
> 24.2 at the far one — so a circle can never fit it, and one sized to the
> camera's width walks its cards out of the spotlight, which is only ~5.9
> across. Depth also cannot scale with aspect the way width can: the camera
> switches shape at aspect 1 and takes its vertical fov with it.

## Status

Working: full ruleset, three bot tiers, solo play, LAN multiplayer with room
codes, chat, spectating, reconnect, 3D table with real lighting and shadows,
card animations, match history, and synthesised sound.

The Docker image is built and exercised on every push by
`.github/workflows/docker.yml`: it waits for `/health`, fetches the page and
the bundle that page references, then opens a WebSocket and creates a room.
That last check is the point of the image — serving a WebSocket is the one
thing GitHub Pages cannot do.

Not implemented: the optional 1000-point scoring across hands. The instruction
sheet lists it as an alternative victory method; this plays single hands.
