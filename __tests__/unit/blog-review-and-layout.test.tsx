import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EngineSummaryCard,
  GameDates,
  GameWalkthrough,
  MoveSectionCard,
  SectionBody,
  formatMoveCount,
  type MoveSection,
} from '@/components/blog-shared';
import { summarizeAnalysis, type AnalysisSummary } from '@/lib/analysis-utils';

// ─── helpers ──────────────────────────────────────────────────────────────────

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6';

const section = (over: Partial<MoveSection> = {}): MoveSection => ({
  type: 'move',
  header: 'Move 3: Bb5',
  timestamp: '2026-06-01T10:00:00.000Z',
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  userColor: 'white',
  thinking: 'Going for the Ruy Lopez.',
  moveNotation: 'Bb5',
  opponentLastMove: 'Nc6 (b8-c6)',
  plyIndex: 4,
  engineEval: null,
  aiReview: null,
  postReview: null,
  ...over,
});

const mv = (color: 'white' | 'black', moveQuality: string, centipawnLoss: number) => ({ color, moveQuality, centipawnLoss });

const summary: AnalysisSummary = summarizeAnalysis({
  whiteAccuracy: 88.5,
  blackAccuracy: 74.2,
  moves: [
    mv('white', 'book', 0), mv('black', 'book', 0),
    mv('white', 'excellent', 10), mv('black', 'good', 40),
    mv('white', 'excellent', 20), mv('black', 'inaccuracy', 80),
    mv('white', 'good', 30), mv('black', 'mistake', 150),
    mv('white', 'blunder', 400), mv('black', 'blunder', 350),
  ],
})!;

const walkthrough = (props: Partial<React.ComponentProps<typeof GameWalkthrough>> = {}) =>
  renderToStaticMarkup(<GameWalkthrough pgn={PGN} userColor="white" sections={[section()]} {...props} />);

/** The text of each <dt>/<th> + <td> pair in the review table, keyed by the row label. */
const rowsOf = (html: string) => {
  const rows: Record<string, string[]> = {};
  for (const tr of html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)) {
    const label = tr[1].match(/<th[^>]*scope="row"[^>]*>(.*?)<\/th>/)?.[1];
    if (!label) continue;
    rows[label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()] = [...tr[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  }
  return rows;
};

// ─── the game's dates ─────────────────────────────────────────────────────────

describe('GameDates', () => {
  const render = (props: React.ComponentProps<typeof GameDates>) => renderToStaticMarkup(<GameDates {...props} />);
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('calls out the start and end dates separately, labelled', () => {
    const html = render({ startDate: '2026-07-10', endDate: '2026-07-24' });

    expect(text(html)).toBe('Started 2026-07-10 Finished 2026-07-24');
  });

  it('shows the start before the end', () => {
    const html = render({ startDate: '2026-07-10', endDate: '2026-07-24' });
    expect(html.indexOf('Started')).toBeLessThan(html.indexOf('Finished'));
  });

  it('marks each date up as a date a machine can read', () => {
    const html = render({ startDate: '2026-07-10', endDate: '2026-07-24' });

    // (React's static renderer keeps the camelCase name; HTML attribute names are case-insensitive)
    expect(html).toMatch(/<time dateTime="2026-07-10"[^>]*>2026-07-10<\/time>/);
    expect(html).toMatch(/<time dateTime="2026-07-24"[^>]*>2026-07-24<\/time>/);
  });

  it('shows both even when the game began and ended on the same day', () => {
    expect(text(render({ startDate: '2026-07-10', endDate: '2026-07-10' }))).toBe('Started 2026-07-10 Finished 2026-07-10');
  });

  it('shows only the end when the start is not known', () => {
    const html = render({ startDate: null, endDate: '2026-07-24' });

    expect(text(html)).toBe('Finished 2026-07-24');
    expect(html).not.toContain('Started');
  });

  it('shows only the start for a game still being played', () => {
    const html = render({ startDate: '2026-07-10', endDate: null });

    expect(text(html)).toBe('Started 2026-07-10');
    expect(html).not.toContain('Finished');
  });

  it('shows nothing, not an empty paragraph, when neither date is known', () => {
    expect(render({ startDate: null, endDate: null })).toBe('');
    expect(render({})).toBe('');
  });

  it('can be told apart from the labels by weight and colour, with a dark-mode treatment', () => {
    const html = render({ startDate: '2026-07-10', endDate: '2026-07-24' });

    expect(html).toContain('font-medium text-gray-700 dark:text-gray-300');
    expect(html).toContain('text-gray-500 dark:text-gray-400');
  });

  it('wraps onto a second line on a narrow screen instead of overflowing', () => {
    expect(render({ startDate: '2026-07-10', endDate: '2026-07-24' })).toContain('flex flex-wrap');
  });
});

// ─── whole-move counting ──────────────────────────────────────────────────────

describe('formatMoveCount', () => {
  it('counts whole moves: both players moving once is one move', () => {
    expect(formatMoveCount(0)).toBe('0');
    expect(formatMoveCount(2)).toBe('1');
    expect(formatMoveCount(16)).toBe('8');
  });

  it('shows a half-played move as .5', () => {
    expect(formatMoveCount(1)).toBe('0.5');
    expect(formatMoveCount(9)).toBe('4.5');
    expect(formatMoveCount(17)).toBe('8.5');
  });

  it('reads 8 moves each as 8 / 8, and part-way through as 4.5 / 8', () => {
    expect(`${formatMoveCount(16)} / ${formatMoveCount(16)}`).toBe('8 / 8');
    expect(`${formatMoveCount(9)} / ${formatMoveCount(16)}`).toBe('4.5 / 8');
  });

  it('never prints a trailing .0', () => {
    for (let plies = 0; plies < 60; plies++) expect(formatMoveCount(plies)).not.toMatch(/\.0$/);
  });
});

describe('the move counter on the board', () => {
  it('counts whole moves, not half-moves: 4 plies to the guess reads 0 / 2', () => {
    const html = walkthrough();
    expect(html).toContain('0 / 2');
    expect(html).not.toContain('0 / 4');
  });

  it('shows half a move for an odd number of plies', () => {
    // Guess at ply 5 (Black's move 3): five plies to step through.
    const html = walkthrough({ sections: [section({ plyIndex: 5, moveNotation: 'a6', header: 'Move 3: a6', userColor: 'black' })], userColor: 'black' });
    expect(html).toContain('0 / 2.5');
  });

  it('is wide enough for a counter like 12.5 / 40.5', () => {
    expect(walkthrough()).toContain('min-w-[4.5rem]');
  });
});

// ─── the engine's top line ────────────────────────────────────────────────────

describe('the engine check — top line', () => {
  const body = (s: MoveSection, phase: 'thinking_shown' | 'complete' = 'complete') =>
    renderToStaticMarkup(<SectionBody section={s} phase={phase} />);

  const missed = section({
    engineEval: { moveQuality: 'good', centipawnLoss: 25, evaluation: 0.4, bestMoveSan: 'd4', topLine: '6. d4 exd4 7. e5 Ne4' },
  });

  it('shows the engine’s whole line once the move is solved, when my move was not the top move', () => {
    const html = body(missed);

    expect(html).toContain('Engine&#x27;s top line');
    expect(html).toContain('6. d4 exd4 7. e5 Ne4');
  });

  it('sets the line apart as notation', () => {
    expect(body(missed)).toMatch(/<span data-notation="true"[^>]*>6\. d4 exd4 7\. e5 Ne4<\/span>/);
  });

  it('gives the evaluation the top line leads to, rebuilt from my move and its loss', () => {
    // 0.4 + 0.25 = 0.65 -> prints as +0.7, like the figures beside it
    expect(body(missed)).toMatch(/Engine&#x27;s top line<\/span><span[^>]*>\+0\.7<\/span>/);
  });

  it('rebuilds it the right way round for Black', () => {
    const black = section({
      userColor: 'black',
      engineEval: { moveQuality: 'good', centipawnLoss: 25, evaluation: -0.4, bestMoveSan: 'd5', topLine: '6... d5' },
    });
    expect(body(black)).toMatch(/Engine&#x27;s top line<\/span><span[^>]*>-0\.7<\/span>/);
  });

  it('falls back to the best move on its own when no line was stored', () => {
    const html = body(section({ engineEval: { moveQuality: 'good', centipawnLoss: 25, evaluation: 0.4, bestMoveSan: 'd4' } }));

    expect(html).toContain('Engine&#x27;s top line');
    expect(html).toMatch(/<span data-notation="true"[^>]*>d4<\/span>/);
  });

  it('prefers the line to the single move when both are there', () => {
    expect(body(missed)).not.toMatch(/<span data-notation="true"[^>]*>d4<\/span>/);
  });

  it('shows no top line when my move was the engine’s top move', () => {
    const html = body(section({ engineEval: { moveQuality: 'excellent', centipawnLoss: 0, evaluation: 0.3 } }));

    expect(html).toContain('Evaluation of the position');
    expect(html).not.toContain('top line');
    expect(html).toContain('best move'); // "My move vs. the engine's best: best move"
  });

  it('keeps the top line hidden until the move is solved', () => {
    const html = body(missed, 'thinking_shown');

    expect(html).not.toContain('Engine&#x27;s top line');
    expect(html).not.toContain('6. d4 exd4');
  });

  it('shows it on the older card too', () => {
    const html = renderToStaticMarkup(<MoveSectionCard section={{ ...missed, moveNotation: null }} />);

    expect(html).toContain('Engine&#x27;s top line:');
    expect(html).toContain('6. d4 exd4 7. e5 Ne4');
  });

  it('does not show a top line on the older card when my move was the top move', () => {
    const html = renderToStaticMarkup(
      <MoveSectionCard section={section({ moveNotation: null, engineEval: { moveQuality: 'excellent', centipawnLoss: 0, evaluation: 0.3 } })} />
    );
    expect(html).not.toContain('top line');
  });
});

// ─── the engine review card ───────────────────────────────────────────────────

describe('EngineSummaryCard', () => {
  const html = renderToStaticMarkup(
    <EngineSummaryCard summary={summary} players={{ white: 'romank', black: 'opponent_a' }} userColor="white" />
  );
  const rows = rowsOf(html);

  it('is titled as the engine review', () => {
    expect(html).toContain('Engine review');
  });

  it('names both players, and marks which one is me', () => {
    expect(html).toContain('romank');
    expect(html).toContain('opponent_a');
    expect(html).toContain('White · me');
    expect(html).not.toContain('Black · me');
  });

  it('marks Black as me when I played Black', () => {
    const black = renderToStaticMarkup(
      <EngineSummaryCard summary={summary} players={{ white: 'romank', black: 'opponent_a' }} userColor="black" />
    );
    expect(black).toContain('Black · me');
    expect(black).not.toContain('White · me');
  });

  it('shows both players’ accuracy', () => {
    expect(rows['Accuracy']).toEqual(['88.5%', '74.2%']);
  });

  it('shows the average centipawn loss per move for both', () => {
    // White non-book: 10, 20, 30, 400 -> 115. Black non-book: 40, 80, 150, 350 -> 155.
    expect(rows['Average loss per move']).toEqual(['115 cp', '155 cp']);
  });

  it('shows how many moves were analysed for each', () => {
    expect(rows['Moves analysed']).toEqual(['5', '5']);
  });

  it('counts moves in every category, for each player', () => {
    expect(rows['Book opening theory']).toEqual(['1', '1']);
    expect(rows['Excellent ≤ 25 cp lost']).toEqual(['2', '0']);
    expect(rows['Good ≤ 50 cp']).toEqual(['1', '1']);
    expect(rows['Inaccuracy ≤ 100 cp']).toEqual(['0', '1']);
    expect(rows['Mistake ≤ 200 cp']).toEqual(['0', '1']);
    expect(rows['Blunder &gt; 200 cp']).toEqual(['1', '1']); // the markup escapes ">"
  });

  it('lists the categories best to worst, as on the analysis page', () => {
    const order = ['Book', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].map(n => html.indexOf(`>${n}</span>`));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('uses the analysis page’s colour for each category', () => {
    expect(html).toContain('bg-purple-100 text-purple-800'); // book
    expect(html).toContain('bg-green-100 text-green-800');
    expect(html).toContain('bg-blue-100 text-blue-800');
    expect(html).toContain('bg-yellow-100 text-yellow-800');
    expect(html).toContain('bg-orange-100 text-orange-800');
    expect(html).toContain('bg-red-100 text-red-800');
  });

  it('has a dark-mode treatment for every category badge', () => {
    for (const c of ['purple', 'green', 'blue', 'yellow', 'orange', 'red']) {
      expect(html).toContain(`dark:bg-${c}-900 dark:text-${c}-200`);
    }
  });

  it('mutes categories with no moves', () => {
    const zero = html.match(/<td[^>]*text-gray-500[^>]*>0<\/td>/g) ?? [];
    expect(zero.length).toBe(3); // White: inaccuracy, mistake; Black: excellent
  });

  it('is a proper table, with the column and row headings marked', () => {
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it('falls back to White and Black when the names are not known', () => {
    const anon = renderToStaticMarkup(<EngineSummaryCard summary={summary} userColor="white" />);
    expect(anon).toMatch(/block break-words">White</);
    expect(anon).toMatch(/block break-words">Black</);
  });

  it('shows a dash for a figure that was not recorded, and drops a row nobody has', () => {
    const partial: AnalysisSummary = {
      white: { ...summary.white, accuracy: 90 },
      black: { ...summary.black, accuracy: null, averageCentipawnLoss: null },
    };
    const some = rowsOf(renderToStaticMarkup(<EngineSummaryCard summary={partial} userColor="white" />));
    expect(some['Accuracy']).toEqual(['90%', '—']);
    expect(some['Average loss per move']).toEqual(['115 cp', '—']);

    const none: AnalysisSummary = {
      white: { ...summary.white, accuracy: null, averageCentipawnLoss: null },
      black: { ...summary.black, accuracy: null, averageCentipawnLoss: null },
    };
    const bare = rowsOf(renderToStaticMarkup(<EngineSummaryCard summary={none} userColor="white" />));
    expect(bare['Accuracy']).toBeUndefined();
    expect(bare['Average loss per move']).toBeUndefined();
    expect(bare['Moves analysed']).toBeDefined();
  });

  it('shows a name as text, never as markup', () => {
    const evil = renderToStaticMarkup(
      <EngineSummaryCard summary={summary} players={{ white: '<img src=x onerror=alert(1)>', black: 'b' }} userColor="white" />
    );
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
  });
});

// ─── the review at the end of the game ────────────────────────────────────────

describe('GameWalkthrough — the engine review at the end', () => {
  it('stays sealed until the game has been played through, like the summary', () => {
    const html = walkthrough({ analysisSummary: summary, summary: '**Lesson:** pace myself.' });

    expect(html).not.toContain('Engine review');
    expect(html).not.toContain('88.5%');
    expect(html).not.toContain('pace myself');
    expect(html).toContain('Overall summary'); // the locked placeholder
    expect(html).toContain('Unlocks at the end');
  });

  it('is announced by the locked placeholder when there is no written summary', () => {
    const html = walkthrough({ analysisSummary: summary, summary: '' });

    expect(html).toContain('📊 Engine review');
    expect(html).toContain('Unlocks at the end');
    expect(html).not.toContain('88.5%');
  });

  it('shows no placeholder at all when there is neither a summary nor an analysis', () => {
    const html = walkthrough({ analysisSummary: null, summary: '' });

    expect(html).not.toContain('Unlocks at the end');
    expect(html).not.toContain('Engine review');
  });

  it('appears straight away in the plain layout used when the game cannot be walked through', () => {
    const html = renderToStaticMarkup(
      <GameWalkthrough
        pgn=""
        userColor="white"
        sections={[]}
        summary="**Lesson:** pace myself."
        analysisSummary={summary}
        players={{ white: 'romank', black: 'opponent_a' }}
      />
    );

    expect(html).toContain('Engine review');
    expect(html).toContain('88.5%');
    expect(html).toContain('pace myself');
  });

  it('comes before my own summary there', () => {
    const html = renderToStaticMarkup(
      <GameWalkthrough pgn="" userColor="white" sections={[]} summary="Lesson text." analysisSummary={summary} />
    );
    expect(html.indexOf('Engine review')).toBeLessThan(html.indexOf('Overall summary'));
  });

  it('is left out in the plain layout when the game was not analysed', () => {
    const html = renderToStaticMarkup(
      <GameWalkthrough pgn="" userColor="white" sections={[]} summary="Lesson text." analysisSummary={null} />
    );
    expect(html).not.toContain('Engine review');
    expect(html).toContain('Overall summary');
  });
});

// ─── a wider layout ───────────────────────────────────────────────────────────

describe('the walkthrough card layout', () => {
  const html = walkthrough();

  it('lays out in two columns once the card itself is wide, by container rather than screen size', () => {
    expect(html).toContain('@container');
    expect(html).toContain('@4xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]');
  });

  it('keeps one column on narrow cards, and one that cannot be forced wider by its contents', () => {
    // Without minmax(0, …) a single `auto` track grows to the widest control row
    // and pushes the card's right-hand edge out of view on a phone.
    const classes = html.match(/class="([^"]*grid gap-4[^"]*)"/)![1].split(' ');
    const base = classes.filter(c => c.startsWith('grid-cols'));
    const wide = classes.filter(c => c.startsWith('@4xl:grid-cols'));

    expect(base).toEqual(['grid-cols-[minmax(0,1fr)]']);
    expect(wide).toEqual(['@4xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]']);
  });

  it('wraps the step controls rather than overflowing a narrow card, and shrinks the buttons on phones', () => {
    expect(html).toContain('flex flex-wrap items-center justify-center gap-2 sm:gap-2.5');
    expect(html).toContain('w-11 h-11 sm:w-12 sm:h-12');
  });

  it('puts the board on the left and the prompts, feedback and commentary on the right', () => {
    expect(html).toContain('@4xl:col-start-1 @4xl:row-start-1 @4xl:row-span-2'); // board column
    expect(html).toContain('@4xl:col-start-2 @4xl:row-start-1'); // prompts
    expect(html).toContain('@4xl:col-start-2 @4xl:row-start-2'); // feedback and commentary
  });

  describe('keeping the board in view beside tall commentary', () => {
    const board = html.match(/class="([^"]*@4xl:row-span-2[^"]*)"/)![1].split(' ');

    it('sticks the board column to the window in two columns, as tall as itself so it has room to travel', () => {
      expect(board).toContain('@4xl:self-start');
      expect(board).toContain('@4xl:[@media(min-height:42rem)]:sticky');
      expect(board).toContain('@4xl:[@media(min-height:42rem)]:top-4');
    });

    it('does not stick in one column, where it would sit over the text, or on a window too short to hold it', () => {
      expect(board).not.toContain('sticky');
      expect(board).not.toContain('@4xl:sticky');
      expect(board.filter(c => c.includes('sticky'))).toEqual(['@4xl:[@media(min-height:42rem)]:sticky']);
    });

    it('clips the card instead of hiding its overflow, which would make the card the thing the board sticks to', () => {
      const card = html.match(/<div class="([^"]*)"><div class="bg-gray-50 dark:bg-gray-700 px-4 py-2\.5 flex items-center justify-between/)![1];
      expect(card).toContain('overflow-clip');
      expect(card).not.toContain('overflow-hidden');
      expect(card).toContain('rounded-lg');
    });

    it('caps the move list in two columns, so the board column fits the window, and scrolls it', () => {
      const list = html.match(/class="([^"]*font-mono[^"]*@4xl:max-h-24[^"]*)"/)![1];
      expect(list).toContain('@4xl:overflow-y-auto');
      expect(list).toContain('flex-wrap');
    });
  });

  it('collapses an empty prompts area instead of leaving a gap', () => {
    expect(html).toContain('empty:hidden');
  });

  it('keeps the prompts above the board when there is only one column', () => {
    expect(html.indexOf('Find my move on the board')).toBeLessThan(html.indexOf('0 / 2'));
  });

  it('keeps the progress chip clear of the cards, moving it beside the column only on very wide screens', () => {
    expect(html).toContain('top-3 right-3 2xl:top-1/3 2xl:right-10');
    expect(html).not.toContain('lg:right-10');
  });

  it('tells readers that a move the engine rates as well as mine, or better, counts too', () => {
    const intro = html.match(/<p class="max-w-3xl[^"]*">(This post follows[\s\S]*?)<\/p>/)![1];

    expect(intro).toContain('If you find a move the');
    expect(intro).toContain('engine rates as well as mine, or better, that counts too.');
    // …and still says the original thing about guessing
    expect(intro).toContain('isn&#x27;t necessarily the best one');
  });

  it('tells readers they can skip a move, and that every move is scored', () => {
    const intro = html.match(/<p class="max-w-3xl[^"]*">(This post follows[\s\S]*?)<\/p>/)![1];

    expect(intro).toContain('or skip a move');
    expect(intro).toContain('Every move is scored.');
  });

  it('keeps running text a readable width on a wide page', () => {
    expect(html).toMatch(/<p class="max-w-3xl[^"]*">This post follows my game/);
  });
});
