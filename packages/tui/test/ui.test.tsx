/**
 * TUI tests.
 *
 * These drive the REAL renderer with mock keyboard input and assert on the
 * captured character frame, so they catch layout and binding regressions that
 * a pure-logic test can't see.
 */
import { describe, expect, test } from 'bun:test';
import { act } from 'react';

// These tests assert on static layout, so animation is disabled to keep frames
// deterministic. Animation behaviour has its own suite in animation.test.tsx.
process.env.UNO_NO_ANIMATION = '1';
import { testRender } from '@opentui/react/test-utils';
import { Menu } from '../src/screens/Menu.js';
import { Table } from '../src/screens/Table.js';
import { LocalGame } from '../src/game/local.js';

const SIZE = { width: 120, height: 40 };

/**
 * Press a key and let React commit before the next assertion.
 *
 * Without act(), a setState triggered by the keypress is still queued when
 * captureCharFrame() runs, so the frame shows the PREVIOUS state and the test
 * silently asserts against stale output.
 */
async function press(
  t: Awaited<ReturnType<typeof testRender>>,
  key: Parameters<typeof t.mockInput.pressKey>[0],
) {
  await act(async () => {
    t.mockInput.pressKey(key);
  });
  await t.flush();
}

describe('menu', () => {
  test('renders the title and every mode', async () => {
    const t = await testRender(<Menu onChoose={() => {}} onQuit={() => {}} defaultName="you" />, SIZE);
    await t.flush();
    const frame = t.captureCharFrame();
    expect(frame).toContain('NO MERCY');
    expect(frame).toContain('play vs bots');
    expect(frame).toContain('host a game');
    expect(frame).toContain('join a game');
    expect(frame).toContain('spectate');
    expect(frame).toContain('your record');
  });

  test('arrow keys change the opponent count', async () => {
    const t = await testRender(<Menu onChoose={() => {}} onQuit={() => {}} defaultName="you" />, SIZE);
    await t.flush();
    await act(async () => {
      t.mockInput.pressEnter();
    });
    await t.flush();
    await press(t, 'ARROW_RIGHT');
    expect(t.captureCharFrame()).toContain('4 bots');
    await press(t, 'ARROW_LEFT');
    await press(t, 'ARROW_LEFT');
    expect(t.captureCharFrame()).toContain('2 bots');
  });

  test('down then right changes difficulty, not the bot count', async () => {
    const t = await testRender(<Menu onChoose={() => {}} onQuit={() => {}} defaultName="you" />, SIZE);
    await t.flush();
    await act(async () => {
      t.mockInput.pressEnter();
    });
    await t.flush();
    await press(t, 'ARROW_DOWN');
    await press(t, 'ARROW_RIGHT');
    const frame = t.captureCharFrame();
    expect(frame).toContain('hard');
    expect(frame).toContain('3 bots');
  });

  test('choosing a mode then settings emits the right choice', async () => {
    const choices: unknown[] = [];
    const t = await testRender(
      <Menu onChoose={(c) => choices.push(c)} onQuit={() => {}} defaultName="you" />,
      SIZE,
    );
    await t.flush();
    // Enter opens the "play vs bots" pane, then enter again starts it.
    await act(async () => {
      t.mockInput.pressEnter();
    });
    await t.flush();
    await press(t, 'ARROW_RIGHT');
    await act(async () => {
      t.mockInput.pressEnter();
    });
    await t.flush();
    expect(choices).toEqual([{ kind: 'solo', botCount: 4, difficulty: 'medium' }]);
  });
});

describe('table', () => {
  const mkGame = () =>
    new LocalGame({ seed: 1234, humanName: 'you', botCount: 3, difficulty: 'medium' });

  test('renders opponents, piles and the hand', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await t.flush();
    const frame = t.captureCharFrame();
    expect(frame).toContain('draw');
    expect(frame).toContain('discard');
    expect(frame).toContain('colour');
    expect(frame).toContain('your hand');
    // Three bots, all dealt 7.
    expect(frame).toContain('7 cards');
  });

  test('shows the hand count and updates it when you draw', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await t.flush();
    expect(t.captureCharFrame()).toContain('your hand — 7 cards');

    // Only meaningful while it's actually our turn; seed 1234 deals us first.
    expect(game.waitingOnHuman()).toBe(true);
    await press(t, 'd');
    expect(game.raw.players[0]!.hand.length).toBeGreaterThanOrEqual(8);
  });

  test('q exits the table', async () => {
    let exited = false;
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => (exited = true)} />, SIZE);
    await t.flush();
    await press(t, 'q');
    expect(exited).toBe(true);
  });

  test('the log can be toggled off', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await t.flush();
    const withLog = t.captureCharFrame();
    await press(t, 'l');
    const withoutLog = t.captureCharFrame();
    expect(withoutLog).not.toBe(withLog);
  });

  test('a live stack is shown as a warning', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await t.flush();
    expect(t.captureCharFrame()).toContain('no stack');
  });

  test('never renders a bot hand', async () => {
    const game = mkGame();
    const t = await testRender(<Table game={game} onExit={() => {}} />, SIZE);
    await t.flush();
    const frame = t.captureCharFrame();
    // Bot hands are only ever a count. If a bot's card face leaked into the
    // frame the redaction boundary is broken.
    for (const bot of game.raw.players.slice(1)) {
      expect(bot.hand.length).toBe(7);
    }
    expect(frame).toContain('7 cards');
  });
});
