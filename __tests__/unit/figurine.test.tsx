import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { splitPieces } from '@/lib/figurine';
import { Figurines } from '@/components/Figurines';

const shown = (text: string) =>
  renderToStaticMarkup(<Figurines>{text}</Figurines>).replace(/<span[^>]*>(.)<\/span>/gu, '$1');

describe('splitPieces', () => {
  it('marks the letter a piece move opens with', () => {
    expect(splitPieces('Nf3')).toEqual([{ text: 'N', piece: 'N' }, { text: 'f3' }]);
  });

  it('gives back the original text when joined', () => {
    for (const text of ['Nf3', '9...Bxd2+ 10. Nxd2 Qxd2', 'e8=Q#', 'O-O-O', 'Nbd2', 'R1e2', 'exd5']) {
      expect(splitPieces(text).map(s => s.text).join('')).toBe(text);
    }
  });
});

describe('Figurines', () => {
  it('draws every piece as its symbol', () => {
    expect(shown('Kg1 Qh4+ Rxe1 Bb5 Nc6')).toBe('♚g1 ♛h4+ ♜xe1 ♝b5 ♞c6');
  });

  it('draws the pieces in a run of numbered moves', () => {
    expect(shown('9...Bxd2+ 10. Nxd2 Qxd2')).toBe('9...♝xd2+ 10. ♞xd2 ♛xd2');
    expect(shown('12… Nf6')).toBe('12… ♞f6');
  });

  it('keeps the file or rank that tells two pieces apart', () => {
    expect(shown('Nbd2')).toBe('♞bd2');
    expect(shown('R1e2')).toBe('♜1e2');
  });

  it('draws a promotion’s piece', () => {
    expect(shown('e8=Q#')).toBe('e8=♛#');
    expect(shown('bxa1=N')).toBe('bxa1=♞');
  });

  it('leaves pawn moves and castling alone', () => {
    expect(shown('e4 exd5 O-O O-O-O')).toBe('e4 exd5 O-O O-O-O');
  });

  it('changes only the moves in prose, never a word', () => {
    expect(shown('Bad idea: Nf3 loses to Qa5, so Bc4 instead.')).toBe('Bad idea: ♞f3 loses to ♛a5, so ♝c4 instead.');
    expect(shown('Kasparov and Nakamura')).toBe('Kasparov and Nakamura');
    expect(shown('Na')).toBe('Na');
  });

  it('leaves a hand-typed move that is not notation as it was', () => {
    expect(shown('Bishop to b5')).toBe('Bishop to b5');
  });

  it('keeps the opponent’s move with its squares', () => {
    expect(shown('Nc4 (c3-c4)')).toBe('♞c4 (c3-c4)');
  });

  it('sets each symbol apart in a font that has it, labelled with its letter', () => {
    const html = renderToStaticMarkup(<Figurines>Nf3</Figurines>);
    expect(html).toMatch(/^<span data-figurine="N" class="[^"]*Segoe_UI_Symbol[^"]*">♞<\/span>f3$/);
  });
});
