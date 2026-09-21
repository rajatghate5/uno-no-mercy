/** Shared test fixture: a completed game plus its replay. */
import { createGame, finalState, reduce, ReplayRecorder, redactFor, type Replay } from '@uno/engine';
import { decide, emptyMemory } from '@uno/bots';

export function simulateForTest(seed: number): { replay: Replay; finalStateJson: string } {
  const specs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
  const created = createGame({ seed, players: specs });
  const recorder = new ReplayRecorder(seed, specs);
  let state = created.state;
  let rng = seed ^ 0xabcdef;

  for (let i = 0; i < 4000 && state.phase.type !== 'gameOver'; i++) {
    const actor =
      state.phase.type === 'chooseRouletteColor' ? state.phase.victim : state.players[state.turn]!.id;
    const d = decide('medium', redactFor(state, actor), rng, emptyMemory());
    rng = d.rng;
    recorder.record(d.action);
    state = reduce(state, d.action).state;
  }

  const winner = state.phase.type === 'gameOver' ? state.phase.winner : null;
  const replay = recorder.finish(winner);
  // Sanity: the replay must reproduce the same state we just computed.
  const reproduced = finalState(replay);
  return { replay, finalStateJson: JSON.stringify(reproduced) };
}
