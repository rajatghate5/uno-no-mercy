/** Dev tool: print several frames of the deal animation, to eyeball motion. */
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
process.env.UNO_NO_ANIMATION = '';
import { Table } from '../src/screens/Table.js';
import { LocalGame } from '../src/game/local.js';

const game = new LocalGame({ seed: 1234, humanName: 'rajat', botCount: 3, difficulty: 'hard' });
const t = await testRender(<Table game={game} onExit={() => {}} />, { width: 92, height: 34 });

const shots = [0, 180, 360, 540, 900];
let elapsed = 0;
for (const at of shots) {
  while (elapsed < at) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 16));
    });
    await t.renderOnce();
    elapsed += 16;
  }
  const frame = t.captureCharFrame();
  // Just the hand rows, which is where the deal animation lives.
  const rows = frame.split('\n');
  const start = rows.findIndex((r) => r.includes('your hand'));
  console.log(`\n--- t=${at}ms ---`);
  console.log(rows.slice(start, start + 8).join('\n'));
}
process.exit(0);
