/** CLI: bun run sim [count] [players] — bulk simulation with invariant checks. */
import { simulate, InvariantError } from './harness.js';

const count = Number(process.argv[2] ?? 1000);
const players = Number(process.argv[3] ?? 4);

let ok = 0;
const failures: { seed: number; message: string }[] = [];
let totalTurns = 0;
let totalElims = 0;
const winners: Record<string, number> = {};

const started = performance.now();
for (let seed = 1; seed <= count; seed++) {
  try {
    const r = simulate({ seed, playerCount: players });
    ok++;
    totalTurns += r.turns;
    totalElims += r.eliminations;
    if (r.winner) winners[r.winner] = (winners[r.winner] ?? 0) + 1;
  } catch (e) {
    const message = e instanceof InvariantError ? e.message : String(e);
    if (failures.length < 10) failures.push({ seed, message });
  }
}
const ms = performance.now() - started;

console.log(`\n${ok}/${count} games completed  (${ms.toFixed(0)}ms, ${(count / (ms / 1000)).toFixed(0)}/s)`);
if (ok > 0) {
  console.log(`avg turns: ${(totalTurns / ok).toFixed(1)}   avg eliminations: ${(totalElims / ok).toFixed(2)}`);
  console.log(`win distribution:`, winners);
}
if (failures.length) {
  console.log(`\n${count - ok} FAILURES. First few:`);
  for (const f of failures) console.log(`  ${f.message}`);
  process.exit(1);
}
