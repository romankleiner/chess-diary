import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameWalkthrough, type MoveSection } from '@/components/blog-shared';
import { OUTCOME_LABEL, ScoreBreakdown, ScoreCard, ScoreLegend, TriesLeft, formatPoints } from '@/components/blog-score';
import { summarizeScores, type PositionScore } from '@/lib/guess-score';

const score = (over: Partial<PositionScore> = {}): PositionScore => ({
  outcome: 'mine', revealed: false, tryNumber: 1, points: 100,
  lines: [{ label: 'Found my move', points: 100 }],
  ...over,
});

/** The visible text of rendered markup. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ─── formatting ───────────────────────────────────────────────────────────────

describe('formatPoints', () => {
  it('writes a proper minus sign', () => {
    expect(formatPoints(-30)).toBe('−30');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(150)).toBe('150');
  });
});

// ─── tries left ───────────────────────────────────────────────────────────────

describe('TriesLeft', () => {
  const dots = (html: string, kind: 'left' | 'used') => (html.match(new RegExp(`data-try="${kind}"`, 'g')) ?? []).length;

  it.each([[3, 3, 0], [2, 2, 1], [1, 1, 2], [0, 0, 3]])('with %d left shows %d filled and %d used', (left, filled, used) => {
    const html = renderToStaticMarkup(<TriesLeft left={left} />);
    expect(dots(html, 'left')).toBe(filled);
    expect(dots(html, 'used')).toBe(used);
  });

  it('says how many are left to a screen reader, and hides the dots from one', () => {
    const html = renderToStaticMarkup(<TriesLeft left={2} />);
    expect(html).toContain('aria-label="2 of 3 tries left"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-hidden="true"');
  });
});

// ─── one move's score ─────────────────────────────────────────────────────────

describe('ScoreBreakdown', () => {
  const html = renderToStaticMarkup(
    <ScoreBreakdown
      score={score({
        points: 40,
        lines: [
          { label: 'Found my move', points: 100 },
          { label: 'Try 2 of 3: ×0.6', points: -40 },
          { label: 'Mistake: Qh5', points: -20 },
        ],
      })}
    />,
  );

  it('shows the total, then each line with its label', () => {
    const text = textOf(html);
    expect(text).toContain('Your score for this move');
    expect(html).toMatch(/data-score-total[^>]*>40</);
    for (const label of ['Found my move', 'Try 2 of 3: ×0.6', 'Mistake: Qh5']) expect(text).toContain(label);
  });

  it('signs each change, with a proper minus sign', () => {
    const text = textOf(html);
    expect(text).toContain('+100');
    expect(text).toContain('−40');
    expect(text).toContain('−20');
  });

  it('colours gains and losses differently', () => {
    expect(html).toMatch(/text-green-700[^"]*"[^>]*>\+100</);
    expect(html).toMatch(/text-red-700[^"]*"[^>]*>−40</);
  });

  it('shows a negative total with a minus sign', () => {
    const negative = renderToStaticMarkup(<ScoreBreakdown score={score({ points: -30, lines: [{ label: 'Blunder: a3', points: -30 }] })} />);
    expect(negative).toMatch(/data-score-total[^>]*>−30</);
  });

  it('shows a line worth nothing in neutral grey, as neither a gain nor a loss', () => {
    const skipped = renderToStaticMarkup(<ScoreBreakdown score={score({ outcome: 'skipped', points: 0, lines: [{ label: 'Skipped', points: 0 }] })} />);
    const row = skipped.match(/<dd class="([^"]*)">0</)![1];
    expect(row).toContain('text-gray-600');
    expect(row).not.toMatch(/green|red/);
  });

  it('says a guess is still being checked only while one is', () => {
    expect(textOf(html)).not.toContain('Still checking');
    const pending = renderToStaticMarkup(<ScoreBreakdown score={score()} pending />);
    expect(textOf(pending)).toContain('Still checking one of your earlier guesses');
  });

  it('is announced as a status', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Your score for this move"');
  });

  it('escapes anything in a label that is not text', () => {
    const evil = renderToStaticMarkup(<ScoreBreakdown score={score({ lines: [{ label: 'Blunder: <img src=x onerror=alert(1)>', points: -30 }] })} />);
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
  });
});

// ─── the score at the end ─────────────────────────────────────────────────────

describe('ScoreCard', () => {
  const scores: PositionScore[] = [
    score({ outcome: 'mine', points: 100 }),
    score({ outcome: 'better', points: 175, revealed: true }),
    score({ outcome: 'skipped', points: 0 }),
    score({ outcome: 'out_of_tries', points: -30 }),
  ];
  const summary = summarizeScores(scores, 4);
  const rows = [
    { header: 'Move 3: Bb5', score: scores[0] },
    { header: 'Move 6: Re1', score: scores[1] },
    { header: 'Move 9: d4', score: scores[2] },
    { header: 'Move 12: Qh5', score: scores[3] },
  ];
  const html = renderToStaticMarkup(<ScoreCard summary={summary} rows={rows} />);
  const text = textOf(html);

  it('shows the total out of a flawless game, as a percentage', () => {
    expect(html).toMatch(/data-score-total[^>]*>245</);
    expect(text).toContain('out of 400');
    expect(text).toContain('61%');
    expect(text).toContain('400 is a flawless game');
  });

  it('counts each way the moves ended, leaving out the ones that did not happen', () => {
    expect(text).toContain('Found my move');
    expect(text).toContain('Found a move better than mine');
    expect(text).toContain('Skipped');
    expect(text).toContain('Out of tries');
    expect(text).not.toContain('Found a move as good as mine');
    expect(text).not.toContain('Not played');
  });

  it('counts the moves solved with my thinking hidden and open', () => {
    expect(text).toContain('Solved without reading my thinking');
    expect(text).toContain('Solved after reading my thinking');
  });

  it('lists every move with how it ended and what it scored', () => {
    for (const row of rows) expect(text).toContain(row.header);
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toMatch(/text-red-700[^"]*"[^>]*>−30</);
    expect(html).toMatch(/>175</);
  });

  it('praises a score over 100% and no other', () => {
    expect(text).not.toContain('out-thought');
    const over = summarizeScores([score({ outcome: 'better', points: 200 })], 1);
    expect(textOf(renderToStaticMarkup(<ScoreCard summary={over} rows={[{ header: 'Move 3', score: score({ outcome: 'better', points: 200 }) }]} />)))
      .toContain('You out-thought the author');
    const exact = summarizeScores([score()], 1);
    expect(textOf(renderToStaticMarkup(<ScoreCard summary={exact} rows={[{ header: 'Move 3', score: score() }]} />))).not.toContain('out-thought');
  });

  it('shows a move never reached as not played, scoring nothing', () => {
    const partial = summarizeScores([scores[0]], 2);
    const card = renderToStaticMarkup(
      <ScoreCard summary={partial} rows={[{ header: 'Move 3: Bb5', score: scores[0] }, { header: 'Move 6', score: null }]} />,
    );
    expect(textOf(card)).toContain('Not played');
    expect(textOf(card)).toContain('Move 6');
    expect(textOf(card)).not.toContain('Move 6: Re1');
    // in the list itself, not only in the tally above it
    const [first, second] = card.match(/<li [^>]*>.*?<\/li>/g)!;
    expect(textOf(first)).toContain('Found my move');
    expect(textOf(second)).toContain('Not played');
    expect(textOf(second)).not.toContain('Found');
    expect(second).toMatch(/text-gray-600[^"]*"[^>]*>0</);
  });

  it('shows a negative total, and its percentage, with a minus sign', () => {
    const owed = summarizeScores([score({ outcome: 'out_of_tries', points: -30 })], 1);
    const card = renderToStaticMarkup(<ScoreCard summary={owed} rows={[]} />);
    expect(card).toMatch(/data-score-total[^>]*>−30</);
    expect(textOf(card)).toContain('−30%');
    expect(textOf(card)).not.toContain('-30');
  });

  it('has a name for every way a move can end', () => {
    expect(Object.keys(OUTCOME_LABEL).sort()).toEqual(['better', 'equal', 'mine', 'open', 'out_of_tries', 'skipped']);
  });

  it('escapes a move name that is not text', () => {
    const evil = renderToStaticMarkup(<ScoreCard summary={summary} rows={[{ header: '<img src=x onerror=alert(1)>', score: scores[0] }]} />);
    expect(evil).not.toContain('<img');
  });
});

// ─── the rules ────────────────────────────────────────────────────────────────

describe('ScoreLegend', () => {
  const html = renderToStaticMarkup(<ScoreLegend />);
  const text = textOf(html);

  it('is a closed disclosure, so it does not crowd the introduction', () => {
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(text).toContain('How scoring works');
  });

  it('states the points for finding my move and beating it', () => {
    expect(text).toContain('100');
    expect(text).toMatch(/plus 25.100 more/);
  });

  it('states what reading my thinking does', () => {
    expect(text).toContain('worth 50%');
    expect(text).toContain('25 extra');
  });

  it('states the tries and what each is worth', () => {
    expect(text).toContain('3 tries');
    expect(text).toContain('60%');
    expect(text).toContain('30%');
    expect(text).toContain('scores 0');
  });

  it('states every penalty and the cap', () => {
    expect(text).toMatch(/10 for more than half a pawn/);
    expect(text).toMatch(/20 for more than one/);
    expect(text).toMatch(/30 for more than two/);
    expect(text).toMatch(/40 for walking into a forced mate/);
    expect(text).toContain('at most 60 a move');
  });
});

// ─── in the walkthrough ───────────────────────────────────────────────────────

describe('GameWalkthrough — scoring', () => {
  const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6';
  const section = (over: Partial<MoveSection> = {}): MoveSection => ({
    type: 'move', header: 'Move 3: Bb5', timestamp: '2026-06-01T10:00:00.000Z', fen: null, userColor: 'white',
    thinking: 'Going for the Ruy Lopez.', moveNotation: 'Bb5', opponentLastMove: 'Nc6 (b8-c6)', plyIndex: 4,
    engineEval: { moveQuality: 'excellent', centipawnLoss: 0, evaluation: 0.3 }, aiReview: null, postReview: null,
    ...over,
  });
  const html = renderToStaticMarkup(<GameWalkthrough pgn={PGN} userColor="white" sections={[section()]} />);

  it('explains the scoring beside the introduction', () => {
    expect(textOf(html)).toContain('Every move is scored');
    expect(html).toContain('data-score-legend');
  });

  it('shows a running score, starting at 0, beside the progress', () => {
    expect(html).toMatch(/Score\s*<\/span><span[^>]*data-score-total[^>]*>0</);
  });

  it('shows no scorecard until the game is played through', () => {
    expect(html).not.toContain('data-score-card');
  });

  it('says reading the thinking is no longer the only way to move on: a skip is offered from the start', () => {
    // the controls appear when the board reaches the move; the introduction says so now
    expect(textOf(html)).toContain('or skip a move');
  });

  it('mentions that a move as good as mine counts', () => {
    expect(textOf(html)).toContain('as well as mine, or better');
  });
});
