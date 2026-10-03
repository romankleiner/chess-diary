import { describe, it, expect } from 'vitest';
import { splitNotation } from '@/lib/notation';

/** Just the pieces that were recognised as notation, in order. */
const found = (text: string) => splitNotation(text).filter(s => s.notation).map(s => s.text);

describe('splitNotation — what it finds', () => {
  it("finds the author's own style: a Black move with its number, then White's reply", () => {
    expect(found('I should have played 9...Bxd2+ 10. Nxd2 here.')).toEqual(['9...Bxd2+ 10. Nxd2']);
  });

  it('finds the AI’s canonical style, which has a space after the dots', () => {
    expect(found('The line 9... Bxd2+ 10. Nxd2 Qxd2 wins a pawn.')).toEqual(['9... Bxd2+ 10. Nxd2 Qxd2']);
  });

  it('finds a lone move', () => {
    expect(found('I played Nf3 because it develops.')).toEqual(['Nf3']);
  });

  it.each([
    ['pawn push', 'e4'],
    ['pawn capture', 'exd5'],
    ['piece move', 'Bb5'],
    ['piece capture', 'Qxe5'],
    ['check', 'Qh5+'],
    ['checkmate', 'Qxf7#'],
    ['promotion', 'e8=Q'],
    ['promotion with check', 'b1=N+'],
    ['disambiguated by file', 'Nbd7'],
    ['disambiguated by rank', 'R1e2'],
    ['disambiguated capture', 'Rdxd1'],
    ['short castling', 'O-O'],
    ['long castling', 'O-O-O'],
    ['castling with check', 'O-O+'],
    ['castling written with zeros', '0-0'],
    ['good move', 'Nf3!'],
    ['blunder', 'Qxb2??'],
    ['interesting move', 'Bxh7+!?'],
  ])('finds a %s (%s)', (_name, move) => {
    expect(found(`After ${move} things changed.`)).toEqual([move]);
  });

  it('finds moves with a number and no space: 10.Nxd2', () => {
    expect(found('then 10.Nxd2 follows')).toEqual(['10.Nxd2']);
  });

  it('finds a Black move given only by dots: ...Bxd2+', () => {
    expect(found('he replied ...Bxd2+ immediately')).toEqual(['...Bxd2+']);
    expect(found('he replied …Bxd2+ immediately')).toEqual(['…Bxd2+']);
  });

  it('keeps a whole variation as one run', () => {
    expect(found('Try 1. e4 e5 2. Nf3 Nc6 3. Bb5 for the Ruy Lopez.')).toEqual(['1. e4 e5 2. Nf3 Nc6 3. Bb5']);
  });

  it('finds separate pieces of notation separately', () => {
    expect(found('Not Nf3 but d4, and later Qd2.')).toEqual(['Nf3', 'd4', 'Qd2']);
  });

  it('does not include the punctuation around a move', () => {
    expect(found('(Nf3)')).toEqual(['Nf3']);
    expect(found('"Nf3,"')).toEqual(['Nf3']);
    expect(found('I played Nf3.')).toEqual(['Nf3']);
    expect(found('Nf3, e5; Nc6')).toEqual(['Nf3', 'e5', 'Nc6']);
  });

  it('finds a move at the very start and very end of the text', () => {
    expect(found('Nf3 was fine')).toEqual(['Nf3']);
    expect(found('it was Nf3')).toEqual(['Nf3']);
    expect(found('Nf3')).toEqual(['Nf3']);
  });

  it('finds moves on separate lines of one string', () => {
    expect(found('First Nf3\nthen d4')).toEqual(['Nf3', 'd4']);
  });

  it('does not run a variation across a line break', () => {
    expect(found('Nf3\ne5')).toEqual(['Nf3', 'e5']);
  });

  it('treats a square the same as a move', () => {
    expect(found('the pawn on e5 is weak')).toEqual(['e5']);
  });
});

describe('splitNotation — what it leaves alone', () => {
  it.each([
    'Nothing to see here, just words.',
    'I felt a bit tired and rushed it.',
    'Be careful with the bishop; Re-check the king.',
    'Bishop, Knight, Queen, King, Rook.',
    'The b-pawn and the h-file were open.',
    'Score was 1-0 and then 0-1; a 1/2-1/2 draw.',
    'It cost 3.5 points, maybe 10.5.',
    'I scored 2. That was fine.',
    'See A1, B2 and C3 for details.',
    'Version v2 and 4K video.',
    'Move 9 was the mistake.',
    '',
  ])('finds nothing in: %s', text => {
    expect(found(text)).toEqual([]);
  });

  it('does not take a move out of the middle of a word or number', () => {
    expect(found('abc4')).toEqual([]);
    expect(found('Nf3x')).toEqual([]);
    expect(found('xe4')).toEqual([]);
    expect(found('e4abc')).toEqual([]);
    expect(found('e2e4')).toEqual([]); // long algebraic is not understood; better unmarked than half-marked
    expect(found('word_e4')).toEqual([]);
  });

  it('does not mistake an ordinary uppercase letter plus number for a piece move', () => {
    expect(found('B2 bomber, N7 road, R9')).toEqual([]);
  });

  it('does not read a rank of 9 or a file beyond h', () => {
    expect(found('e9 and i4 and a0')).toEqual([]);
  });

  it('leaves a trailing move number alone when no move follows it', () => {
    expect(found('see move 10. Then it ends')).toEqual([]);
  });
});

describe('splitNotation — the segments', () => {
  it('gives back exactly the text it was given, in order', () => {
    const samples = [
      'I should have played 9...Bxd2+ 10. Nxd2 here.',
      'Not Nf3 but d4, and (later) Qd2!',
      'no moves at all',
      '',
      'Nf3',
      'ends with a move Nf3',
      'Nf3 starts with one',
      '**Bold** around Nf3 and e4\nnext line 10. Nxd2',
      '…Bxd2+ and …Qxd2',
    ];
    for (const text of samples) {
      expect(splitNotation(text).map(s => s.text).join('')).toBe(text);
    }
  });

  it('marks notation and words alternately', () => {
    expect(splitNotation('Try Nf3 now')).toEqual([
      { text: 'Try ', notation: false },
      { text: 'Nf3', notation: true },
      { text: ' now', notation: false },
    ]);
  });

  it('never returns an empty segment', () => {
    for (const text of ['Nf3', 'Nf3 e5', 'a Nf3', 'Nf3 a', '', 'x']) {
      expect(splitNotation(text).every(s => s.text.length > 0)).toBe(true);
    }
  });

  it('returns nothing for empty text', () => {
    expect(splitNotation('')).toEqual([]);
  });

  it('returns one plain segment when there is no notation', () => {
    expect(splitNotation('just words')).toEqual([{ text: 'just words', notation: false }]);
  });

  it('can be called repeatedly with the same results (no state carried between calls)', () => {
    const text = 'try Nf3 then d4';
    expect(splitNotation(text)).toEqual(splitNotation(text));
    expect(found(text)).toEqual(found(text));
  });
});

describe('splitNotation — realistic commentary', () => {
  it('handles a paragraph of the author’s own thinking', () => {
    const text = 'Protecting e4 prophylactically before he can play b5 and Na5 ideas. I considered d4 but ...exd4 and Nxd4 Nxd4 Qxd4 is equal.';
    expect(found(text)).toEqual(['e4', 'b5', 'Na5', 'd4', '...exd4', 'Nxd4 Nxd4 Qxd4']);
  });

  it('handles AI commentary with a canonical line and a lone move', () => {
    const text = 'Black could have tried 9... Bxd2+ 10. Nxd2 Qxd2, but Re1 was safer.';
    expect(found(text)).toEqual(['9... Bxd2+ 10. Nxd2 Qxd2', 'Re1']);
  });

  it('copes with a long variation without slowing to a crawl', () => {
    const line = Array.from({ length: 200 }, (_, i) => `${i + 1}. Nf3 Nc6`).join(' ');
    const start = performance.now();
    const result = found(line);
    expect(performance.now() - start).toBeLessThan(500);
    expect(result).toHaveLength(1);
  });

  it('copes with long text that is nearly notation but is not', () => {
    const text = 'Nf '.repeat(5000) + 'e'.repeat(5000);
    const start = performance.now();
    splitNotation(text);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
