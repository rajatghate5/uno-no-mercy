/**
 * Solo-game tests.
 *
 * Regression guard for a bug that reached the user: stepBot() existed but
 * nothing in the web client ever called it, so a solo game froze the moment a
 * bot's turn began ("Ada is thinking..." forever).
 *
 * It slipped through because the full-game end-to-end test drove a
 * NetworkGame, where the SERVER steps the bots - so nothing exercised the
 * client's own bot loop.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { decide, emptyMemory } from '@mercy/bots';
import { LocalGame } from '../src/game/local.js';

describe('local game', () => {
  test('a solo game plays to completion when bots are stepped', () => {
    const game = new LocalGame({
      seed: 4242,
      humanName: 'you',
      botCount: 3,
      difficulty: 'medium',
    });

    let rng = 0x51ed;
    let guard = 0;
    while (!game.isOver && guard++ < 5000) {
      if (game.waitingOnHuman()) {
        const d = decide('medium', game.view(), rng, emptyMemory());
        rng = d.rng;
        game.apply(d.action);
      } else {
        // The exact call the client must make on a timer.
        const stepped = game.stepBot();
        expect(stepped).toBe(true);
      }
    }

    expect(game.isOver).toBe(true);
    expect(game.winner).not.toBeNull();
  });

  test('stepBot refuses to act when it is the human turn', () => {
    const game = new LocalGame({ seed: 7, humanName: 'you', botCount: 2, difficulty: 'easy' });
    expect(game.waitingOnHuman()).toBe(true);
    // Returning false is what lets the client's loop stop cleanly.
    expect(game.stepBot()).toBe(false);
  });

  test('the client actually wires up the bot loop', () => {
    // The bug was purely wiring: the method existed and was never called.
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/stepBot\(\)/);
    expect(main).toMatch(/scheduleBotTurn/);
    // ...and only for local games, or a networked client races the server.
    expect(main).toMatch(/instanceof LocalGame/);
  });
});
