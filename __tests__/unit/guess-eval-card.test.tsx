import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuessEvalCard, GameWalkthrough, formatEval, type GuessEvalState, type MoveSection } from '@/components/blog-shared';
import { compareGuess } from '@/lib/guess-eval';
import type { PositionEval } from '@/lib/position-eval';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ev = (pawns: number, mate: number | null = null): PositionEval => ({ pawns, mate, depth: 12 });

const done = (
  guess: PositionEval,
  mine: number,
  top: number,
  color: 'white' | 'black',
  san = 'Nf3',
): GuessEvalState => ({
  san,
  status: 'done',
  rating: { guessEval: guess, comparison: compareGuess({ guess, mine, top, color }) },
});

const card = (state: GuessEvalState, color: 'white' | 'black' = 'white') =>
  renderToStaticMarkup(<GuessEvalCard state={state} color={color} />);

/** The text of each <dt>/<dd> pair, e.g. { 'After your move': '+0.2' }. */
const rowsOf = (html: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>\s*([^<]*?)\s*<\/dd>/g)) out[m[1]] = m[2];
  return out;
};

// ─── the three states ─────────────────────────────────────────────────────────

describe('GuessEvalCard — states', () => {
  it('says it is checking while the engine works, naming the move', () => {
    const html = card({ san: 'Qxd5', status: 'loading' });
    expect(html).toContain('Checking your move with the engine');
    expect(html).toContain('Qxd5');
  });

  it('shows the reason when the check fails, and no numbers', () => {
    const html = card({ san: 'Nf3', status: 'error', message: 'Could not evaluate that position right now.' });
    expect(html).toContain('Could not evaluate that position right now.');
    expect(html).not.toContain('<dt');
  });

  it('is announced politely to screen readers', () => {
    const html = card({ san: 'Nf3', status: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Engine check of your guess"');
  });

  it('puts the loading and error text in escaped form, not as markup', () => {
    const html = card({ san: 'Nf3', status: 'error', message: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

// ─── the result ───────────────────────────────────────────────────────────────

describe('GuessEvalCard — result', () => {
  const html = card(done(ev(0.2), 0.8, 1.2, 'white'));

  it('lists the position after the guess, after my move, and the engine’s top line', () => {
    expect(rowsOf(html)).toEqual({
      'After your move': '+0.2',
      'After my move': '+0.8',
      "Engine&#x27;s top line": '+1.2',
    });
  });

  it('gives the verdict against the top line and against my move', () => {
    expect(html).toContain('1.0 behind the engine&#x27;s top line');
    expect(html).toContain('Worse than my move by 0.6');
  });

  it('grades the guess with the same labels as my own moves', () => {
    expect(html).toContain('⚠ Inaccuracy'); // 1.0 pawn = 100 cp short
    expect(card(done(ev(1.2), 0.8, 1.2, 'white'))).toContain('✓ Excellent');
    expect(card(done(ev(-0.5), 0.8, 1.2, 'white'))).toContain('✗ Mistake'); // 1.7 short
    expect(card(done(ev(-3), 0.8, 1.2, 'white'))).toContain('✗✗ Blunder');
  });

  it('colours the verdict by quality', () => {
    expect(card(done(ev(1.2), 0.8, 1.2, 'white'))).toContain('text-green-700');
    expect(html).toContain('text-yellow-700');
    expect(card(done(ev(-0.5), 0.8, 1.2, 'white'))).toContain('text-orange-700');
    expect(card(done(ev(-3), 0.8, 1.2, 'white'))).toContain('text-red-700');
  });

  it('uses the darker shades for the verdict: the lighter ones are too faint on the grey card', () => {
    for (const guess of [1.2, 0.7, 0.2, -0.5, -3]) {
      const verdict = card(done(ev(guess), 0.8, 1.2, 'white'));
      expect(verdict).not.toMatch(/text-(green|blue|yellow|orange|red)-600/);
    }
  });

  it('names the guess in the heading', () => {
    expect(card(done(ev(0.2), 0.8, 1.2, 'white', 'Bxf7+'))).toContain('Bxf7+');
  });
});

// ─── point of view ────────────────────────────────────────────────────────────

describe('GuessEvalCard — Black’s point of view', () => {
  // Black's moves: White-POV numbers are negative when good for Black.
  const html = card(done(ev(-0.2), -0.8, -1.2, 'black'), 'black');

  it('prints evaluations White’s way up, as the engine check beside it does', () => {
    expect(rowsOf(html)).toEqual({
      'After your move': '-0.2',
      'After my move': '-0.8',
      "Engine&#x27;s top line": '-1.2',
    });
  });

  it('still judges the guess from Black’s side', () => {
    expect(html).toContain('1.0 behind the engine&#x27;s top line');
    expect(html).toContain('Worse than my move by 0.6');
  });

  it('says the numbers are from White’s point of view, for Black only', () => {
    expect(html).toContain('White&#x27;s point of view');
    expect(card(done(ev(0.2), 0.8, 1.2, 'white'), 'white')).not.toContain('point of view');
  });
});

// ─── mates ────────────────────────────────────────────────────────────────────

describe('GuessEvalCard — forced mates', () => {
  it('shows how far away the guess’s mate is, and "Mate" where the length is unknown', () => {
    const html = card(done(ev(100, 3), 100, 100, 'white'));
    expect(rowsOf(html)).toMatchObject({
      'After your move': '+M3',
      'After my move': '+Mate',
    });
    expect(html).toContain('Finds the forced mate');
  });

  it('shows a mate against the guess with its sign', () => {
    const html = card(done(ev(-100, -2), 0.3, 0.5, 'white'));
    expect(rowsOf(html)['After your move']).toBe('-M2');
    expect(html).toContain('Walks into a forced mate');
  });

  it('shows Black’s mate as -M with Black playing it', () => {
    const html = card(done(ev(-100, -2), -100, -100, 'black'), 'black');
    expect(rowsOf(html)['After your move']).toBe('-M2');
    expect(html).toContain('Finds the forced mate');
  });

  it('says Checkmate when the guess ends the game', () => {
    const html = card(done(ev(100, 0), 100, 100, 'white'));
    expect(rowsOf(html)['After your move']).toBe('Checkmate');
  });
});

// ─── the printed numbers and the sentence agree ───────────────────────────────

describe('GuessEvalCard — numbers agree with the sentence', () => {
  it('at an awkward half-way value, prints what the sentence was worked out from', () => {
    // 0.35 prints 0.3; 1.25 prints 1.3. A shortfall of 1.0 is what the reader can see.
    const html = card(done(ev(0.35), 1.25, 1.25, 'white'));
    expect(rowsOf(html)).toMatchObject({ 'After your move': '+0.3', 'After my move': '+1.3' });
    expect(html).toContain('1.0 behind');
  });
});

// ─── the existing engine check now reads mates properly ───────────────────────

describe('formatEval', () => {
  it('keeps ordinary evaluations as before', () => {
    expect(formatEval(0.3)).toBe('+0.3');
    expect(formatEval(-1.25)).toBe('-1.3');
    expect(formatEval(0)).toBe('0.0');
  });

  it('shows a stored forced mate as Mate, not as ±100.0', () => {
    expect(formatEval(100)).toBe('+Mate');
    expect(formatEval(-100)).toBe('-Mate');
  });
});

// ─── not present before a guess ───────────────────────────────────────────────

describe('GameWalkthrough — before any guess', () => {
  const section: MoveSection = {
    type: 'move',
    header: 'Move 2: Nf3',
    timestamp: '2026-06-01T10:00:00.000Z',
    fen: null,
    userColor: 'white',
    thinking: 'Developing.',
    moveNotation: 'Nf3',
    opponentLastMove: 'e5 (e7-e5)',
    plyIndex: 2,
    engineEval: { moveQuality: 'good', centipawnLoss: 30, evaluation: 0.3, bestMoveSan: 'Nc3', depth: 12 },
    aiReview: null,
    postReview: null,
  };

  it('shows no engine check until the reader makes a move', () => {
    const html = renderToStaticMarkup(
      <GameWalkthrough pgn="1. e4 e5 2. Nf3 Nc6" sections={[section]} userColor="white" />,
    );
    expect(html).not.toContain('Engine check of your guess');
    expect(html).not.toContain('Checking your move');
  });
});
