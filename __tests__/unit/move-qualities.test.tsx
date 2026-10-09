import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chess } from 'chess.js';
import { GameWalkthrough, MoveChips, MoveQualityLegend, type MoveSection } from '@/components/blog-shared';
import { qualitiesByPly, type MoveQualityKey } from '@/lib/analysis-utils';

// ─── qualitiesByPly ───────────────────────────────────────────────────────────

const plies = (pgn: string) => {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true });
};

const GAME = plies('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
const stored = (moveNumber: number, color: string, move: string, moveQuality: string) => ({ moveNumber, color, move, moveQuality });

describe('qualitiesByPly', () => {
  it('gives each move of the game the engine’s verdict, in the game’s order', () => {
    const moves = [
      stored(1, 'white', 'e4', 'book'), stored(1, 'black', 'e5', 'book'),
      stored(2, 'white', 'Nf3', 'excellent'), stored(2, 'black', 'Nc6', 'good'),
      stored(3, 'white', 'Bb5', 'inaccuracy'), stored(3, 'black', 'a6', 'blunder'),
    ];
    expect(qualitiesByPly(moves, GAME)).toEqual(['book', 'book', 'excellent', 'good', 'inaccuracy', 'blunder']);
  });

  it('finds moves by number and colour, whatever order the analysis keeps them in', () => {
    const moves = [stored(2, 'black', 'Nc6', 'mistake'), stored(1, 'black', 'e5', 'good'), stored(1, 'white', 'e4', 'excellent')];
    expect(qualitiesByPly(moves, GAME).slice(0, 4)).toEqual(['excellent', 'good', null, 'mistake']);
  });

  it('leaves a move the analysis stopped short of uncoloured', () => {
    const moves = [stored(1, 'white', 'e4', 'book'), stored(1, 'black', 'e5', 'book')];
    expect(qualitiesByPly(moves, GAME)).toEqual(['book', 'book', null, null, null, null]);
  });

  it('won’t colour a move the analysis has as a different one: it would be of another version of the game', () => {
    expect(qualitiesByPly([stored(1, 'white', 'd4', 'blunder')], GAME)[0]).toBeNull();
  });

  it('ignores check marks, annotations and case in the stored move', () => {
    const game = plies('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#');
    expect(qualitiesByPly([stored(4, 'white', 'qxf7', 'excellent')], game)[6]).toBe('excellent');
    expect(qualitiesByPly([stored(2, 'white', 'Qh5?!', 'inaccuracy')], game)[2]).toBe('inaccuracy');
  });

  it('takes a move stored without its colour, and the older `quality` field', () => {
    expect(qualitiesByPly([{ moveNumber: 1, move: 'e4', moveQuality: 'good' }], GAME)[0]).toBe('good');
    expect(qualitiesByPly([{ moveNumber: 1, color: 'black', move: 'e5', quality: 'mistake' }], GAME)[1]).toBe('mistake');
  });

  it('won’t take the other side’s move of the same number', () => {
    expect(qualitiesByPly([stored(1, 'black', 'e5', 'blunder')], GAME)[0]).toBeNull();
  });

  it.each([['an unknown category', 'brilliant'], ['no category', '']])('leaves a move with %s uncoloured', (_name, quality) => {
    expect(qualitiesByPly([stored(1, 'white', 'e4', quality)], GAME)[0]).toBeNull();
  });

  it.each([null, undefined, 'moves', {}])('colours nothing without a list of moves (%s)', moves => {
    expect(qualitiesByPly(moves, GAME)).toEqual([null, null, null, null, null, null]);
  });
});

// ─── MoveChips ────────────────────────────────────────────────────────────────

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
const QUALITIES: (MoveQualityKey | null)[] = ['book', 'excellent', 'good', 'inaccuracy', 'blunder', 'mistake'];

const chips = (props: Partial<React.ComponentProps<typeof MoveChips>> = {}) => {
  const html = renderToStaticMarkup(
    <MoveChips game={{ sans: SANS }} fromPly={0} toPly={5} viewIdx={0} goTo={() => {}} qualities={QUALITIES} {...props} />,
  );
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, text]) => ({
    text,
    quality: attrs.match(/data-quality="([^"]+)"/)?.[1] ?? null,
    label: attrs.match(/aria-label="([^"]+)"/)?.[1] ?? null,
    title: attrs.match(/title="([^"]+)"/)?.[1] ?? null,
    className: attrs.match(/class="([^"]+)"/)?.[1] ?? '',
  }));
};

describe('MoveChips — colouring', () => {
  it('colours nothing until told to', () => {
    expect(chips().every(c => c.quality === null && !/bg-(green|red|yellow|orange|blue)-100/.test(c.className))).toBe(true);
    expect(chips({ colouredThrough: -1 }).map(c => c.quality)).toEqual([null, null, null, null, null, null]);
  });

  it('colours the moves up to the last one it is told to, and none after', () => {
    expect(chips({ colouredThrough: 3 }).map(c => c.quality)).toEqual(['book', 'excellent', 'good', 'inaccuracy', null, null]);
  });

  it('uses the analysis page’s colours: green excellent, light yellow inaccuracy, red blunder', () => {
    const c = chips({ colouredThrough: 5 });
    expect(c[1].className).toContain('bg-green-100');
    expect(c[3].className).toContain('bg-yellow-100');
    expect(c[4].className).toContain('bg-red-100');
    expect(c[5].className).toContain('bg-orange-100');
    expect(c[2].className).toContain('bg-blue-100');
    expect(c[0].className).toContain('bg-purple-100');
  });

  it('says the verdict in words too, not by colour alone', () => {
    const c = chips({ colouredThrough: 5 });
    expect(c[4]).toMatchObject({ text: '3. Bb5', label: '3. Bb5, blunder', title: 'Blunder' });
    expect(c[3]).toMatchObject({ label: 'Nc6, inaccuracy', title: 'Inaccuracy' });
  });

  it('leaves a move the analysis has no verdict on plain, even in the coloured stretch', () => {
    const c = chips({ colouredThrough: 5, qualities: ['excellent', null, 'good', null, null, null] });
    expect(c.map(x => x.quality)).toEqual(['excellent', null, 'good', null, null, null]);
    expect(c[1].label).toBeNull();
  });

  it('colours nothing for a game without an analysis', () => {
    expect(chips({ colouredThrough: 5, qualities: null }).map(c => c.quality)).toEqual([null, null, null, null, null, null]);
  });
});

describe('MoveChips — the current move and the guessed move', () => {
  it('rings a coloured current move rather than repainting it, so a book move still reads as current', () => {
    const c = chips({ colouredThrough: 5, viewIdx: 1 }); // the position after 1. e4 (book)
    expect(c[0].className).toContain('ring-2');
    expect(c[0].className).toContain('bg-purple-100'); // the book tint
    expect(c[1].className).not.toContain('ring-2');
  });

  it('marks an uncoloured current move with the purple background, as before', () => {
    const c = chips({ viewIdx: 2 });
    expect(c[1].className).toContain('bg-purple-100');
    expect(c[1].className).not.toContain('ring-2');
  });

  it('sets the guessed move in bold in its verdict’s colour', () => {
    const c = chips({ colouredThrough: 4, guessPly: 4, guessColor: 'green' });
    expect(c[4].className).toContain('font-semibold');
    expect(c[4].className).toContain('bg-red-100');
    expect(c[4].className).not.toContain('text-green-700');
  });

  it('shows how the reader did on the guessed move when there is no verdict to show, as before', () => {
    expect(chips({ qualities: null, guessPly: 4, guessColor: 'amber' })[4].className).toContain('text-amber-700');
    expect(chips({ qualities: null, guessPly: 4, guessColor: 'green' })[4].className).toContain('text-green-700');
  });
});

// ─── The walkthrough ──────────────────────────────────────────────────────────

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6';
const section: MoveSection = {
  type: 'move', header: 'Move 3: Bb5', timestamp: '2026-06-01T10:00:00.000Z',
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  userColor: 'white', thinking: 'Going for the Ruy Lopez.', moveNotation: 'Bb5', opponentLastMove: null,
  plyIndex: 4, engineEval: null, aiReview: null, postReview: null,
};
const walkthrough = (moveQualities: (MoveQualityKey | null)[] | null) =>
  renderToStaticMarkup(<GameWalkthrough pgn={PGN} userColor="white" sections={[section]} moveQualities={moveQualities} />);

describe('GameWalkthrough — move colours', () => {
  it('colours none of the moves leading to a move not yet guessed: that would hint at the answer', () => {
    const html = walkthrough(['book', 'book', 'excellent', 'blunder', 'good', 'excellent']);
    expect(html).toContain('>Nc6<'); // the moves leading to it are listed, plain
    expect(html).not.toContain('data-quality=');
  });

  it('explains the colours when the game has them', () => {
    const html = walkthrough(['book', null, null, null, null, null]);
    expect(html).toContain('data-quality-legend');
    for (const name of ['Book', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']) expect(html).toContain(`>${name}<`);
  });

  it.each([['no analysis', null], ['an analysis that covers none of the moves', [null, null, null, null, null, null]]])(
    'has no legend for a game with %s',
    (_name, qualities) => {
      expect(walkthrough(qualities as (MoveQualityKey | null)[] | null)).not.toContain('data-quality-legend');
    },
  );
});

describe('MoveQualityLegend', () => {
  it('shows every category in its colour, best to worst', () => {
    const html = renderToStaticMarkup(<MoveQualityLegend />);
    const names = [...html.matchAll(/<span class="[^"]*(bg-\w+-100)[^"]*">(\w+)<\/span>/g)].map(m => [m[2], m[1]]);
    expect(names).toEqual([
      ['Book', 'bg-purple-100'], ['Excellent', 'bg-green-100'], ['Good', 'bg-blue-100'],
      ['Inaccuracy', 'bg-yellow-100'], ['Mistake', 'bg-orange-100'], ['Blunder', 'bg-red-100'],
    ]);
  });
});
