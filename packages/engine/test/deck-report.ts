/**
 * Print the deck composition. `bun run deck`
 *
 * Useful for eyeballing a change to config/deck.yml against the real deck.
 */
import { buildDeck, DEFAULT_DECK_SPEC } from '@mercy/engine';
const deck = buildDeck();
const byKind = new Map<string, number>();
const byColorKind = new Map<string, number>();
for (const c of deck) {
  byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  const k = `${c.color ?? 'wild'} ${c.kind}`;
  byColorKind.set(k, (byColorKind.get(k) ?? 0) + 1);
}
console.log(`TOTAL CARDS: ${deck.length}`);
console.log(`DISTINCT KINDS: ${byKind.size}\n`);
console.log('per kind (all four colours combined):');
for (const [k, n] of [...byKind].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}
console.log('\nper colour (one colour shown; others identical):');
for (const [k, n] of [...byColorKind].filter(([k]) => k.startsWith('red'))) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}
const reds = deck.filter(c => c.color === 'red').length;
const wilds = deck.filter(c => !c.color).length;
console.log(`\nred subtotal: ${reds}  x4 colours = ${reds*4}`);
console.log(`wild subtotal: ${wilds}`);
console.log(`${reds*4} + ${wilds} = ${reds*4+wilds}`);
console.log(`\nREVERSE cards in deck: ${deck.filter(c=>c.kind==='reverse').length} coloured, plus ${deck.filter(c=>c.kind==='wildReverseDrawFour').length} Wild Reverse Draw 4`);
