/**
 * Event narration, shared by the local and networked games so the log reads
 * identically whichever mode you are in.
 */

import type { GameEvent } from '@uno/engine';

export interface LogEntry {
  text: string;
  tone: 'normal' | 'good' | 'bad' | 'accent';
}

export function describeEvent(e: GameEvent, name: (id: string) => string): LogEntry | null {
  switch (e.type) {
    case 'cardPlayed':
      return { text: `${name(e.player)} played ${describeCard(e.card)}`, tone: 'normal' };
    case 'colorChosen':
      return { text: `${name(e.player)} chose ${e.color}`, tone: 'accent' };
    case 'drew':
      return { text: `${name(e.player)} drew ${e.count}`, tone: 'normal' };
    case 'stackTaken':
      return { text: `${name(e.player)} ate the stack - ${e.count} cards!`, tone: 'bad' };
    case 'stackGrew':
      return { text: `stack is now +${e.total}`, tone: 'bad' };
    case 'skipped':
      return { text: `${name(e.player)} was skipped`, tone: 'normal' };
    case 'everyoneSkipped':
      return { text: `${name(e.by)} skipped EVERYONE`, tone: 'accent' };
    case 'reversed':
      return { text: 'direction reversed', tone: 'accent' };
    case 'handsPassed':
      return { text: 'everyone passed their hand along', tone: 'accent' };
    case 'handsSwapped':
      return { text: `${name(e.a)} swapped hands with ${name(e.b)}`, tone: 'accent' };
    case 'discardedAll':
      return { text: `${name(e.player)} dumped ${e.count} ${e.color} cards`, tone: 'accent' };
    case 'rouletteStarted':
      return { text: `roulette! ${name(e.victim)} draws until ${e.color}`, tone: 'bad' };
    case 'eliminated':
      return { text: `${name(e.player)} hit ${e.handSize} cards - ELIMINATED`, tone: 'bad' };
    case 'finished':
      return { text: `${name(e.player)} went out!`, tone: 'good' };
    case 'gameOver':
      return {
        text: e.winner
          ? e.reason === 'fewestCards'
            ? `${name(e.winner)} wins on fewest cards`
            : `${name(e.winner)} wins`
          : 'game over',
        tone: 'good',
      };
    case 'unoRisked':
      return { text: `${name(e.player)} is on one card`, tone: 'accent' };
    case 'unoCalled':
      return { text: `${name(e.player)}: UNO!`, tone: 'good' };
    case 'unoCaught':
      return { text: `${name(e.by)} caught ${name(e.player)} - draw 2!`, tone: 'bad' };
    case 'reshuffled':
      return { text: `reshuffled ${e.count} cards`, tone: 'normal' };
    case 'swapDeclined':
      return { text: `${name(e.player)} kept their hand`, tone: 'accent' };
    case 'deckExhausted':
      return { text: 'the deck is out of cards', tone: 'bad' };
    default:
      return null;
  }
}

function describeCard(card: { kind: string; color?: string; rank?: number }): string {
  const base =
    card.kind === 'number' ? `${card.rank}` : card.kind.replace(/([A-Z])/g, ' $1').toLowerCase();
  return card.color ? `${card.color} ${base}` : base;
}
