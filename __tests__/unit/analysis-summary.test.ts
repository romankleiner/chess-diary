import { describe, it, expect } from 'vitest';
import { MOVE_QUALITIES, summarizeAnalysis } from '@/lib/analysis-utils';

const mv = (color: 'white' | 'black', moveQuality: string, centipawnLoss: number) => ({ color, moveQuality, centipawnLoss });

describe('summarizeAnalysis — nothing to summarize', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['no moves array', { whiteAccuracy: 90 }],
    ['moves that is not an array', { moves: 'lots' }],
    ['an empty moves array', { moves: [] }],
  ])('returns null for %s', (_name, analysis) => {
    expect(summarizeAnalysis(analysis)).toBeNull();
  });
});

describe('summarizeAnalysis — categories', () => {
  const analysis = {
    whiteAccuracy: 88.5,
    blackAccuracy: 74.2,
    moves: [
      mv('white', 'book', 0), mv('black', 'book', 0),
      mv('white', 'book', 0), mv('black', 'excellent', 5),
      mv('white', 'excellent', 10), mv('black', 'good', 40),
      mv('white', 'excellent', 20), mv('black', 'inaccuracy', 80),
      mv('white', 'good', 30), mv('black', 'mistake', 150),
      mv('white', 'inaccuracy', 90), mv('black', 'blunder', 350),
      mv('white', 'blunder', 400),
    ],
  };
  const summary = summarizeAnalysis(analysis)!;

  it('counts each side’s moves in each category', () => {
    expect(summary.white.counts).toEqual({ book: 2, excellent: 2, good: 1, inaccuracy: 1, mistake: 0, blunder: 1 });
    expect(summary.black.counts).toEqual({ book: 1, excellent: 1, good: 1, inaccuracy: 1, mistake: 1, blunder: 1 });
  });

  it('counts every analysed move for each side', () => {
    expect(summary.white.moves).toBe(7);
    expect(summary.black.moves).toBe(6);
  });

  it('keeps the categories the game analysis page uses, best to worst', () => {
    expect([...MOVE_QUALITIES]).toEqual(['book', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
    expect(Object.keys(summary.white.counts)).toEqual([...MOVE_QUALITIES]);
  });

  it('reports each side’s own accuracy', () => {
    expect(summary.white.accuracy).toBe(88.5);
    expect(summary.black.accuracy).toBe(74.2);
  });

  it('averages centipawn loss without the book moves, as accuracy is', () => {
    // White non-book losses: 10, 20, 30, 90, 400 -> 550 / 5 = 110
    expect(summary.white.averageCentipawnLoss).toBe(110);
    // Black non-book losses: 5, 40, 80, 150, 350 -> 625 / 5 = 125
    expect(summary.black.averageCentipawnLoss).toBe(125);
  });

  it('counts the same move once only', () => {
    const total = (s: typeof summary.white) => Object.values(s.counts).reduce((a, b) => a + b, 0);
    expect(total(summary.white)).toBe(summary.white.moves);
    expect(total(summary.black)).toBe(summary.black.moves);
  });
});

describe('summarizeAnalysis — awkward data', () => {
  it('rounds the average centipawn loss', () => {
    const s = summarizeAnalysis({ moves: [mv('white', 'good', 10), mv('white', 'good', 11)] })!;
    expect(s.white.averageCentipawnLoss).toBe(11); // 10.5 rounds up
  });

  it('has no average when a side has only book moves, or no moves', () => {
    const s = summarizeAnalysis({ moves: [mv('white', 'book', 0), mv('white', 'book', 0)] })!;
    expect(s.white.averageCentipawnLoss).toBeNull();
    expect(s.black.averageCentipawnLoss).toBeNull();
    expect(s.black.moves).toBe(0);
  });

  it('gives a side with no moves all-zero counts', () => {
    const s = summarizeAnalysis({ moves: [mv('white', 'good', 30)] })!;
    expect(Object.values(s.black.counts)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('leaves accuracy null when it was not recorded', () => {
    const s = summarizeAnalysis({ moves: [mv('white', 'good', 30)] })!;
    expect(s.white.accuracy).toBeNull();
    expect(s.black.accuracy).toBeNull();
  });

  it('keeps an accuracy of zero rather than treating it as missing', () => {
    const s = summarizeAnalysis({ whiteAccuracy: 0, moves: [mv('white', 'blunder', 500)] })!;
    expect(s.white.accuracy).toBe(0);
  });

  it('does not count a quality it does not know, but still counts the move', () => {
    const s = summarizeAnalysis({ moves: [mv('white', 'brilliant', 0), mv('white', 'good', 30)] })!;
    expect(s.white.moves).toBe(2);
    expect(s.white.counts.good).toBe(1);
    expect(Object.values(s.white.counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('reads the older `quality` field when `moveQuality` is missing', () => {
    const s = summarizeAnalysis({ moves: [{ color: 'white', quality: 'mistake', centipawnLoss: 150 }] })!;
    expect(s.white.counts.mistake).toBe(1);
  });

  it('skips a loss that is not a number', () => {
    const s = summarizeAnalysis({ moves: [{ color: 'white', moveQuality: 'good' }, mv('white', 'good', 40)] })!;
    expect(s.white.averageCentipawnLoss).toBe(40);
  });

  it('does not change the analysis it is given', () => {
    const analysis = { whiteAccuracy: 90, moves: [mv('white', 'good', 30)] };
    const copy = JSON.parse(JSON.stringify(analysis));
    summarizeAnalysis(analysis);
    expect(analysis).toEqual(copy);
  });
});
