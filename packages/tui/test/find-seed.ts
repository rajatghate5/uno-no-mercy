/**
 * Find a seed that actually shows off the power cards.
 *
 * Rather than staging an artificial hand, this searches real seeded games for
 * one where the human holds several action cards AND a big draw stack builds
 * up - which is the whole point of No Mercy.
 */
import { createGame, isWild, isDrawCard, redactFor, reduce, type Card } from '@uno/engine';
import { decide, emptyMemory } from '@uno/bots';

const power = (c: Card) => isDrawCard(c.kind) || isWild(c.kind) ||
  c.kind === 'skipEveryone' || c.kind === 'discardAll' || c.kind === 'skip' || c.kind === 'reverse';

interface Hit {
  seed: number;
  openingPower: number;
  maxStack: number;
  stackTurn: number;
  eliminations: number;
  kinds: string[];
}

const hits: Hit[] = [];

for (let seed = 1; seed <= 4000; seed++) {
  const specs = [
    { id: 'you', name: 'rajat', isBot: false },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `bot${i}`, name: `B${i}`, isBot: true })),
  ];
  let state = createGame({ seed, players: specs }).state;
  const opening = state.players[0]!.hand;
  const openingPower = opening.filter(power).length;
  // Want a showy opening hand.
  if (openingPower < 5) continue;

  let rng = seed ^ 0xbeef;
  let maxStack = 0;
  let stackTurn = 0;
  let turn = 0;
  while (state.phase.type !== 'gameOver' && turn < 400) {
    turn++;
    const actor =
      state.phase.type === 'chooseRouletteColor' ? state.phase.victim : state.players[state.turn]!.id;
    const d = decide('hard', redactFor(state, actor), rng, emptyMemory());
    rng = d.rng;
    try {
      state = reduce(state, d.action).state;
    } catch {
      break;
    }
    if (state.pendingDraw > maxStack) {
      maxStack = state.pendingDraw;
      stackTurn = turn;
    }
  }

  // Want a real stack war early enough to reach in a short recording.
  if (maxStack < 12 || stackTurn > 60) continue;

  hits.push({
    seed,
    openingPower,
    maxStack,
    stackTurn,
    eliminations: state.players.filter((p) => p.eliminated).length,
    kinds: [...new Set(opening.map((c) => c.kind))],
  });
}

hits.sort((a, b) => b.maxStack - a.maxStack || b.openingPower - a.openingPower);
console.log(`found ${hits.length} candidates\n`);
for (const h of hits.slice(0, 8)) {
  console.log(
    `seed ${String(h.seed).padStart(4)}  power ${h.openingPower}/7  maxStack +${String(h.maxStack).padStart(2)} @turn ${String(h.stackTurn).padStart(2)}  elims ${h.eliminations}`,
  );
  console.log(`            ${h.kinds.join(', ')}`);
}
