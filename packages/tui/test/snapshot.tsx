/**
 * Dev tool: drive a game N turns and print the rendered frame.
 * Uses the bot brain for the human seat too, so it can drive every phase
 * (colour prompts, swaps, roulette) instead of stalling on one.
 */
import { act } from 'react';

// Snapshots capture a settled frame, not a mid-animation one.
process.env.UNO_NO_ANIMATION = '1';
import { testRender } from '@opentui/react/test-utils';
import { decide, emptyMemory } from '@uno/bots';
import { Table } from '../src/screens/Table.js';
import { HUMAN_ID, LocalGame } from '../src/game/local.js';

const turns = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 77);
const game = new LocalGame({ seed, humanName: 'rajat', botCount: 3, difficulty: 'hard' });

let rng = seed ^ 0x1234;
for (let i = 0; i < turns && !game.isOver; i++) {
  if (game.waitingOnHuman()) {
    const d = decide('hard', game.view(), rng, emptyMemory());
    rng = d.rng;
    game.apply(d.action);
  } else {
    game.stepBot();
  }
}

const t = await testRender(<Table game={game} onExit={() => {}} />, { width: 116, height: 38 });
await act(async () => {});
await t.flush();
console.log(t.captureCharFrame());
console.log(
  `— seed ${seed}, ${turns} turns, over=${game.isOver}, winner=${game.winner ?? '-'}, you=${
    game.raw.players.find((p) => p.id === HUMAN_ID)!.hand.length
  } cards`,
);
process.exit(0);
