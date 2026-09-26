/**
 * Difficulty benchmark.
 *
 * A "hard" bot that doesn't beat "easy" is a bug wearing a label. This plays
 * the tiers against each other and rotates seats between runs, so a result
 * can't be an artefact of who sits first.
 */
import { simulate } from './harness.js';
import type { Difficulty } from '@mercy/bots';

function matchup(a: Difficulty, b: Difficulty, games = 2000) {
  let aWins = 0;
  let bWins = 0;
  for (let seed = 1; seed <= games; seed++) {
    // Alternate seating so neither tier keeps the first-move advantage.
    const flip = seed % 2 === 0;
    const difficulties: Difficulty[] = flip ? [b, a, b, a] : [a, b, a, b];
    const r = simulate({ seed, playerCount: 4, difficulties });
    if (!r.winner) continue;
    const idx = Number(r.winner.slice(1));
    const winnerTier = difficulties[idx]!;
    if (winnerTier === a) aWins++;
    else if (winnerTier === b) bWins++;
  }
  const total = aWins + bWins;
  const pct = total ? ((aWins / total) * 100).toFixed(1) : '—';
  console.log(`  ${a.padEnd(6)} vs ${b.padEnd(6)}  ${String(aWins).padStart(5)} : ${String(bWins).padEnd(5)}  ${a} wins ${pct}%`);
}

console.log('\nDifficulty matchups (2v2, seats rotated, 2000 games each):');
matchup('hard', 'easy');
matchup('medium', 'easy');
matchup('hard', 'medium');
