import { describe, it, expect } from 'vitest';
import { compareGuess, type GuessComparison } from '@/lib/guess-eval';
import type { PositionEval } from '@/lib/position-eval';
import {
  DESPITE_ME_POINTS, MATCH_POINTS, MATE_PENALTY, MAX_TRIES, MY_MOVE, PENALTY_CAP, REVEALED_MATCH_SHARE, TRY_MULTIPLIERS,
  addAttempt, emptyLedger, failAttempt, giveUp, hasPending, hasTried, isOutOfTries, judgeGuess, marginBonus, rateAttempt,
  scorePosition, solve, summarizeScores, triesLeft, triesUsed, tryNumber,
  type GuessJudgement, type Ledger, type PositionScore,
} from '@/lib/guess-score';

const ev = (pawns: number): PositionEval => ({ pawns, mate: null, depth: null });
/** The judgement of a guess evaluated at `guess`, where my move is `mine` and the engine's best is `top` (pawns, White's view). */
const judge = (guess: number, mine = 0.3, top = 0.3) =>
  judgeGuess(compareGuess({ guess: ev(guess), mine, top, color: 'white' }));

const BETTER = (margin: number): GuessJudgement => ({ kind: 'better', margin, penalty: 0, reason: null });
const EQUAL: GuessJudgement = { kind: 'equal', margin: 0, penalty: 0, reason: null };
const MISTAKE: GuessJudgement = { kind: 'worse', margin: 0, penalty: 20, reason: 'mistake' };
const BLUNDER: GuessJudgement = { kind: 'worse', margin: 0, penalty: 30, reason: 'blunder' };
const MATED: GuessJudgement = { kind: 'worse', margin: 0, penalty: 40, reason: 'mate' };
const MEH: GuessJudgement = { kind: 'worse', margin: 0, penalty: 0, reason: null };

// ─── building a ledger the way the card does ──────────────────────────────────

interface Step { san?: string; revealed?: boolean; judgement?: GuessJudgement | 'pending' | 'unrated' | 'failed'; solves?: boolean }
const play = (steps: Step[], end?: 'skipped' | 'out_of_tries'): Ledger => {
  let ledger = emptyLedger();
  steps.forEach((s, i) => {
    const id = i + 1;
    const j = s.judgement ?? MY_MOVE;
    const base = { id, san: s.san ?? `m${id}`, revealed: s.revealed ?? false };
    if (j === 'pending' || j === 'failed') {
      ledger = addAttempt(ledger, { ...base, status: 'pending' });
      if (j === 'failed') ledger = failAttempt(ledger, id);
    } else if (j === 'unrated') {
      ledger = addAttempt(ledger, { ...base, status: 'unrated' });
    } else {
      ledger = addAttempt(ledger, { ...base, status: 'rated', judgement: j });
    }
    if (s.solves) ledger = solve(ledger, id);
  });
  return end ? giveUp(ledger, end) : ledger;
};
const scored = (steps: Step[], end?: 'skipped' | 'out_of_tries') => scorePosition(play(steps, end));
const points = (steps: Step[], end?: 'skipped' | 'out_of_tries') => scored(steps, end).points;

// ─── the rules, as written ────────────────────────────────────────────────────

describe('the rules', () => {
  it('are the ones agreed', () => {
    expect(MAX_TRIES).toBe(3);
    expect([...TRY_MULTIPLIERS]).toEqual([1, 0.6, 0.3]);
    expect(MATCH_POINTS).toBe(100);
    expect(REVEALED_MATCH_SHARE).toBe(0.5);
    expect(DESPITE_ME_POINTS).toBe(25);
    expect(PENALTY_CAP).toBe(60);
    expect(MATE_PENALTY).toBe(40);
  });
});

// ─── the bonus for beating my move ────────────────────────────────────────────

describe('marginBonus', () => {
  it.each([
    [0.2, 25], [0.3, 25], [0.4, 25],
    [0.5, 50], [0.7, 50], [0.9, 50],
    [1.0, 75], [1.5, 75], [1.9, 75],
    [2.0, 100], [3.5, 100], [99.7, 100],
  ])('is worth %d pawns better → +%d', (margin, bonus) => {
    expect(marginBonus(margin)).toBe(bonus);
  });
});

// ─── judging one guess ────────────────────────────────────────────────────────

describe('judgeGuess — against my move', () => {
  it('calls a guess within the engine’s noise of mine equal, with no penalty', () => {
    expect(judge(0.3)).toEqual({ kind: 'equal', margin: 0, penalty: 0, reason: null });
    expect(judge(0.4)).toMatchObject({ kind: 'equal' });
    expect(judge(0.2)).toMatchObject({ kind: 'equal' });
  });

  it('calls a guess above mine better, by how much', () => {
    expect(judge(1.0, 0.3, 1.0)).toEqual({ kind: 'better', margin: 0.7, penalty: 0, reason: null });
    expect(judge(0.5, 0.3, 0.5)).toMatchObject({ kind: 'better', margin: 0.2 });
  });

  it('treats a forced mate I missed as far beyond any tier', () => {
    const j = judgeGuess(compareGuess({ guess: ev(100), mine: 0.3, top: 100, color: 'white' }));
    expect(j.kind).toBe('better');
    expect(marginBonus(j.margin)).toBe(100);
  });

  it('treats avoiding a mate I walked into as better too', () => {
    const j = judgeGuess(compareGuess({ guess: ev(0.2), mine: -100, top: 0.5, color: 'white' }));
    expect(j.kind).toBe('better');
    expect(marginBonus(j.margin)).toBe(100);
  });

  it('works from Black’s side', () => {
    const j = judgeGuess(compareGuess({ guess: ev(-1.0), mine: -0.3, top: -1.0, color: 'black' }));
    expect(j).toMatchObject({ kind: 'better', margin: 0.7 });
  });
});

describe('judgeGuess — penalties for a guess worse than mine', () => {
  // my move and the engine's top line both at +0.3, so the loss is how far the guess falls
  it.each([
    [0.1, 0, null], // only 0.2 behind: fine
    [-0.2, 0, null], // exactly 0.5 behind: still fine
    [-0.3, 10, 'inaccuracy'], // 0.6 behind: more than 0.5
    [-0.7, 10, 'inaccuracy'], // exactly 1.0 behind
    [-0.8, 20, 'mistake'], // 1.1 behind
    [-1.7, 20, 'mistake'], // exactly 2.0 behind
    [-1.8, 30, 'blunder'], // 2.1 behind
    [-5, 30, 'blunder'],
  ])('a guess at %d costs %d (%s)', (guess, penalty, reason) => {
    expect(judge(guess)).toMatchObject({ kind: 'worse', penalty, reason });
  });

  it('charges 40 for walking into a forced mate, which outranks a blunder', () => {
    expect(judge(-100)).toEqual({ kind: 'worse', margin: 0, penalty: 40, reason: 'mate' });
  });

  it('does not charge a mate penalty when the engine sees mate against the reader whatever they play', () => {
    const comparison = { vsMine: 'worse', guess: -100, mine: 0, top: -100, lossVsTop: 0, quality: 'excellent' } as unknown as GuessComparison;
    expect(judgeGuess(comparison)).toMatchObject({ kind: 'worse', penalty: 0, reason: null });
  });

  it('charges a blunder for missing a forced mate', () => {
    // I mated; the guess is merely better than nothing
    const j = judgeGuess(compareGuess({ guess: ev(2.0), mine: 100, top: 100, color: 'white' }));
    expect(j).toMatchObject({ kind: 'worse', penalty: 30, reason: 'blunder' });
  });

  it('measures how far behind from the engine’s top line, not from my move', () => {
    // my move was itself a mistake (−2.0 against a top line of +0.3); a worse one is judged by the top line
    expect(judge(-2.5, -2.0, 0.3)).toMatchObject({ kind: 'worse', penalty: 30, reason: 'blunder' });
  });

  it('never penalises a guess at least as good as mine, however far it is from the top line', () => {
    expect(judge(-2.0, -2.0, 0.3)).toMatchObject({ kind: 'equal', penalty: 0 });
    expect(judge(-0.5, -3.0, 1.0)).toMatchObject({ kind: 'better', penalty: 0 });
  });

  it('agrees with the label the engine check shows for the guess', () => {
    for (const guess of [0.1, -0.2, -0.3, -0.7, -0.8, -1.7, -1.8]) {
      const comparison = compareGuess({ guess: ev(guess), mine: 0.3, top: 0.3, color: 'white' });
      const expected = { excellent: 0, good: 0, inaccuracy: 10, mistake: 20, blunder: 30 }[comparison.quality];
      expect(judgeGuess(comparison).penalty, `${guess} (${comparison.quality})`).toBe(expected);
    }
  });
});

// ─── the ledger ───────────────────────────────────────────────────────────────

describe('the ledger — tries', () => {
  it('starts with all tries and nothing pending', () => {
    const ledger = emptyLedger();
    expect(triesUsed(ledger)).toBe(0);
    expect(triesLeft(ledger)).toBe(3);
    expect(hasPending(ledger)).toBe(false);
    expect(isOutOfTries(ledger)).toBe(false);
  });

  it('uses a try for each guess, pending or not', () => {
    const ledger = play([{ judgement: MEH }, { judgement: 'pending' }]);
    expect(triesUsed(ledger)).toBe(2);
    expect(triesLeft(ledger)).toBe(1);
    expect(hasPending(ledger)).toBe(true);
  });

  it('uses a try for a guess where there is no engine check to rate it', () => {
    expect(triesUsed(play([{ judgement: 'unrated' }, { judgement: 'unrated' }]))).toBe(2);
  });

  it('gives a try back when the engine could not be reached', () => {
    const ledger = play([{ judgement: MEH }, { judgement: 'failed' }]);
    expect(triesUsed(ledger)).toBe(1);
    expect(triesLeft(ledger)).toBe(2);
    expect(hasPending(ledger)).toBe(false);
  });

  it('is out of tries once the third is spent and answered, with nothing solved', () => {
    expect(isOutOfTries(play([{ judgement: MEH }, { judgement: MEH }, { judgement: MEH }]))).toBe(true);
    expect(isOutOfTries(play([{ judgement: 'unrated' }, { judgement: 'unrated' }, { judgement: 'unrated' }]))).toBe(true);
  });

  it('is not out of tries while the last answer is outstanding, which might yet solve the move', () => {
    const ledger = play([{ judgement: MEH }, { judgement: MEH }, { judgement: 'pending' }]);
    expect(triesLeft(ledger)).toBe(0);
    expect(isOutOfTries(ledger)).toBe(false);
  });

  it('is out of tries once that last answer comes in worse, but not if it comes in good enough', () => {
    const waiting = play([{ judgement: MEH }, { judgement: MEH }, { judgement: 'pending' }]);
    expect(isOutOfTries(rateAttempt(waiting, 3, MEH))).toBe(true);
    expect(isOutOfTries(solve(rateAttempt(waiting, 3, EQUAL), 3))).toBe(false);
  });

  it('is not out of tries if the third answer fails, since the try comes back', () => {
    const waiting = play([{ judgement: MEH }, { judgement: MEH }, { judgement: 'pending' }]);
    const failed = failAttempt(waiting, 3);
    expect(isOutOfTries(failed)).toBe(false);
    expect(triesLeft(failed)).toBe(1);
  });

  it('is not out of tries once the move is over some other way', () => {
    const three: Step[] = [{ judgement: MEH }, { judgement: MEH }, { judgement: MEH }];
    expect(isOutOfTries(play(three, 'skipped'))).toBe(false);
    expect(isOutOfTries(play(three, 'out_of_tries'))).toBe(false);
  });

  it('never reports fewer than no tries left', () => {
    const ledger = play([{ judgement: MEH }, { judgement: MEH }, { judgement: MEH }, { judgement: MEH }]);
    expect(triesLeft(ledger)).toBe(0);
  });
});

describe('the ledger — repeats', () => {
  it('knows a move already tried, whatever check marks or case it was written with', () => {
    const ledger = play([{ san: 'Nf3+', judgement: MEH }]);
    expect(hasTried(ledger, 'Nf3+')).toBe(true);
    expect(hasTried(ledger, 'Nf3')).toBe(true);
    expect(hasTried(ledger, 'nf3')).toBe(true);
    expect(hasTried(ledger, 'Nc3')).toBe(false);
  });

  it('forgets a move whose try was given back, so it can be played again', () => {
    expect(hasTried(play([{ san: 'Nf3', judgement: 'failed' }]), 'Nf3')).toBe(false);
  });
});

describe('the ledger — which try a guess was', () => {
  it('counts the guesses before it', () => {
    const ledger = play([{ judgement: MEH }, { judgement: MEH }, { judgement: MEH }]);
    expect([1, 2, 3].map(id => tryNumber(ledger, id))).toEqual([1, 2, 3]);
  });

  it('does not count a guess whose try was given back', () => {
    const ledger = play([{ judgement: 'failed' }, { judgement: MEH }, { judgement: MEH }]);
    expect([1, 2, 3].map(id => tryNumber(ledger, id))).toEqual([1, 1, 2]);
  });

  it('counts a guess still pending', () => {
    expect(tryNumber(play([{ judgement: 'pending' }, { judgement: MEH }]), 2)).toBe(2);
  });
});

describe('the ledger — changes', () => {
  it('ignores a guess added twice with the same id, or after the move is over', () => {
    const one = play([{ judgement: MEH }]);
    expect(addAttempt(one, { id: 1, san: 'x', revealed: false, status: 'unrated' })).toBe(one);
    expect(addAttempt(giveUp(one, 'skipped'), { id: 2, san: 'x', revealed: false, status: 'unrated' }).attempts).toHaveLength(1);
  });

  it('rates and fails only a pending guess', () => {
    const rated = play([{ judgement: MEH }]);
    expect(rateAttempt(rated, 1, EQUAL)).toBe(rated);
    expect(failAttempt(rated, 1)).toBe(rated);
    const unrated = play([{ judgement: 'unrated' }]);
    expect(failAttempt(unrated, 1)).toBe(unrated);
  });

  it('keeps a judgement only for a rated guess, whatever else is passed', () => {
    const unrated = addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'unrated', judgement: BLUNDER });
    expect(unrated.attempts[0].judgement).toBeNull();
    const pending = addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'pending', judgement: MY_MOVE });
    expect(pending.attempts[0].judgement).toBeNull();
    expect(solve(pending, 1).ending).toBeNull();
    // so it can neither solve the move nor cost anything
    expect(scorePosition(giveUp(unrated, 'skipped')).points).toBe(0);
    expect(addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'rated', judgement: BLUNDER }).attempts[0].judgement).toBe(BLUNDER);
    expect(addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'rated' }).attempts[0].judgement).toBeNull();
  });

  it('ignores an answer for a guess that is not there', () => {
    const ledger = play([{ judgement: 'pending' }]);
    expect(rateAttempt(ledger, 9, EQUAL)).toBe(ledger);
    expect(failAttempt(ledger, 9)).toBe(ledger);
  });

  it('is solved only by a rated guess that is not worse than mine', () => {
    const pending = play([{ judgement: 'pending' }]);
    expect(solve(pending, 1).ending).toBeNull();
    expect(solve(play([{ judgement: 'unrated' }]), 1).ending).toBeNull();
    expect(solve(play([{ judgement: MISTAKE }]), 1).ending).toBeNull();
    expect(solve(play([{ judgement: MEH }]), 1).ending).toBeNull();
    expect(solve(pending, 7).ending).toBeNull();
    expect(solve(play([{ judgement: MY_MOVE }]), 1).ending).toEqual({ how: 'solved', attemptId: 1 });
    expect(solve(play([{ judgement: EQUAL }]), 1).ending).toEqual({ how: 'solved', attemptId: 1 });
    expect(solve(play([{ judgement: BETTER(0.5) }]), 1).ending).toEqual({ how: 'solved', attemptId: 1 });
  });

  it('is solved once: the first ending stands', () => {
    const solved = play([{ judgement: MY_MOVE, solves: true }]);
    expect(giveUp(solved, 'skipped')).toBe(solved);
    const skipped = play([{ judgement: MY_MOVE }], 'skipped');
    expect(solve(skipped, 1)).toBe(skipped);
    expect(giveUp(skipped, 'out_of_tries')).toBe(skipped);
  });
});

// ─── scoring a move ───────────────────────────────────────────────────────────

describe('scorePosition — what a solved move is worth', () => {
  it('is 100 for my move, thinking hidden, first try', () => {
    expect(scored([{ judgement: MY_MOVE, solves: true }])).toMatchObject({ outcome: 'mine', points: 100, revealed: false, tryNumber: 1 });
  });

  it('is 100 for a move as good as mine', () => {
    expect(scored([{ judgement: EQUAL, solves: true }])).toMatchObject({ outcome: 'equal', points: 100 });
  });

  it('is half after revealing my thinking first, for my move or its equal', () => {
    expect(scored([{ judgement: MY_MOVE, revealed: true, solves: true }])).toMatchObject({ outcome: 'mine', points: 50, revealed: true });
    expect(scored([{ judgement: EQUAL, revealed: true, solves: true }])).toMatchObject({ outcome: 'equal', points: 50 });
  });

  it.each([
    [0.3, 125], [0.7, 150], [1.2, 175], [2.5, 200], [99.7, 200],
  ])('is 100 plus the bonus for a move %d better than mine → %d', (margin, expected) => {
    expect(points([{ judgement: BETTER(margin), solves: true }])).toBe(expected);
  });

  it('is worth 25 more for a better move found after reading my thinking, not less', () => {
    expect(points([{ judgement: BETTER(0.7), revealed: true, solves: true }])).toBe(175);
    expect(points([{ judgement: BETTER(0.7), revealed: true, solves: true }]))
      .toBeGreaterThan(points([{ judgement: BETTER(0.7), solves: true }]));
  });

  it('does not halve a better move', () => {
    expect(points([{ judgement: BETTER(0.3), revealed: true, solves: true }])).toBe(150);
  });

  it('scales the points by the try: 100, 60, 30', () => {
    const miss = { judgement: MEH };
    expect(points([{ judgement: MY_MOVE, solves: true }])).toBe(100);
    expect(points([miss, { judgement: MY_MOVE, solves: true }])).toBe(60);
    expect(points([miss, miss, { judgement: MY_MOVE, solves: true }])).toBe(30);
  });

  it('scales the whole of a better move, extras included', () => {
    const miss = { judgement: MEH };
    expect(points([miss, miss, { judgement: BETTER(2.5), revealed: true, solves: true }])).toBe(Math.round(225 * 0.3));
    expect(points([miss, { judgement: BETTER(0.7), solves: true }])).toBe(90);
  });

  it('combines the halving with the try', () => {
    const miss = { judgement: MEH };
    expect(points([miss, { judgement: MY_MOVE, revealed: true, solves: true }])).toBe(30);
    expect(points([miss, miss, { judgement: MY_MOVE, revealed: true, solves: true }])).toBe(15);
  });

  it('takes whether my thinking was revealed from the guess that solved it', () => {
    // revealed after a first guess that missed, then solved with it open
    expect(points([{ judgement: MEH }, { judgement: MY_MOVE, revealed: true, solves: true }])).toBe(30);
    // a blind guess that was rated better, later than a guess made after revealing
    const ledger = rateAttempt(
      addAttempt(addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'pending' }),
        { id: 2, san: 'b', revealed: true, status: 'rated', judgement: MEH }),
      1, BETTER(0.7),
    );
    expect(scorePosition(solve(ledger, 1))).toMatchObject({ points: 150, revealed: false, tryNumber: 1 });
  });
});

describe('scorePosition — what a move that was not solved is worth', () => {
  it('is 0 for a skip', () => {
    expect(scored([], 'skipped')).toMatchObject({ outcome: 'skipped', points: 0 });
  });

  it('is 0 for running out of tries, with nothing owed', () => {
    expect(scored([{ judgement: MEH }, { judgement: MEH }, { judgement: MEH }], 'out_of_tries')).toMatchObject({ outcome: 'out_of_tries', points: 0 });
  });

  it('is open, and 0, before anything happens', () => {
    expect(scored([])).toMatchObject({ outcome: 'open', points: 0, revealed: false, tryNumber: null, lines: [] });
  });
});

describe('scorePosition — a ledger that does not add up', () => {
  const attempt = (judgement: GuessJudgement) => ({ id: 1, san: 'a', revealed: false, status: 'rated' as const, judgement });

  it('does not take a move as solved by a guess that was worse than mine', () => {
    const ledger: Ledger = { attempts: [attempt(MISTAKE)], ending: { how: 'solved', attemptId: 1 } };
    expect(scorePosition(ledger)).toMatchObject({ outcome: 'open', points: -20 });
  });

  it('does not take a move as solved by a guess that is not there', () => {
    const ledger: Ledger = { attempts: [], ending: { how: 'solved', attemptId: 4 } };
    expect(scorePosition(ledger)).toMatchObject({ outcome: 'open', points: 0 });
  });

  it('charges a penalty only to a guess that was worse than mine', () => {
    const odd: GuessJudgement = { kind: 'better', margin: 0.5, penalty: 20, reason: 'mistake' };
    expect(scorePosition({ attempts: [attempt(odd)], ending: { how: 'skipped' } }).points).toBe(0);
  });
});

describe('scorePosition — penalties', () => {
  it('are taken from the move, even one the reader goes on to solve', () => {
    expect(points([{ judgement: MISTAKE }, { judgement: MY_MOVE, solves: true }])).toBe(60 - 20);
  });

  it('are the same whether or not my thinking was revealed', () => {
    expect(points([{ judgement: BLUNDER, revealed: true }], 'skipped')).toBe(-30);
    expect(points([{ judgement: BLUNDER, revealed: false }], 'skipped')).toBe(-30);
    expect(points([{ judgement: BLUNDER, revealed: true }, { judgement: MY_MOVE, revealed: true, solves: true }])).toBe(30 - 30);
  });

  it('can leave a skipped or abandoned move below zero', () => {
    expect(points([{ judgement: MATED }], 'skipped')).toBe(-40);
    expect(points([{ judgement: BLUNDER }, { judgement: MEH }, { judgement: MEH }], 'out_of_tries')).toBe(-30);
  });

  it('add up over the guesses', () => {
    expect(points([{ judgement: MISTAKE }, { judgement: BLUNDER }], 'skipped')).toBe(-50);
  });

  it('stop at the cap of 60 a move, and say so', () => {
    const score = scored([{ judgement: BLUNDER }, { judgement: BLUNDER }, { judgement: MATED }], 'out_of_tries');
    expect(score.points).toBe(-60);
    expect(score.lines.map(l => l.label)).toContain('Penalties capped at −60');
    expect(score.lines.reduce((sum, l) => sum + l.points, 0)).toBe(-60);
  });

  it('are not capped below the cap', () => {
    expect(points([{ judgement: BLUNDER }, { judgement: BLUNDER }], 'skipped')).toBe(-60);
    expect(scored([{ judgement: BLUNDER }, { judgement: BLUNDER }], 'skipped').lines.map(l => l.label).join()).not.toContain('capped');
  });

  it('take nothing for a move that was only slightly worse', () => {
    expect(points([{ judgement: MEH }], 'skipped')).toBe(0);
  });

  it('take nothing yet for a guess the engine has not answered, and the whole of it once it does', () => {
    const waiting = play([{ judgement: 'pending' }], 'skipped');
    expect(scorePosition(waiting).points).toBe(0);
    expect(scorePosition(rateAttempt(waiting, 1, BLUNDER)).points).toBe(-30);
  });

  it('count a late answer for a move already solved', () => {
    const ledger = rateAttempt(
      solve(addAttempt(addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'pending' }),
        { id: 2, san: 'b', revealed: false, status: 'rated', judgement: MY_MOVE }), 2),
      1, BLUNDER,
    );
    expect(scorePosition(ledger).points).toBe(60 - 30);
  });

  it('are shown on the open move as they are earned', () => {
    expect(points([{ judgement: MISTAKE }])).toBe(-20);
  });

  it('give nothing for a guess that was better than mine but not the one that solved it', () => {
    const ledger = rateAttempt(
      solve(addAttempt(addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'pending' }),
        { id: 2, san: 'b', revealed: false, status: 'rated', judgement: MY_MOVE }), 2),
      1, BETTER(2.5),
    );
    expect(scorePosition(ledger)).toMatchObject({ outcome: 'mine', points: 60 });
  });

  it('are not charged for a guess whose try was given back', () => {
    expect(points([{ judgement: 'failed' }, { judgement: MY_MOVE, solves: true }])).toBe(100);
  });
});

describe('scorePosition — the examples from the proposal', () => {
  it.each<[string, Step[], 'skipped' | 'out_of_tries' | undefined, number]>([
    ['hidden, first try, my move', [{ judgement: MY_MOVE, solves: true }], undefined, 100],
    ['hidden, first try, an equally good move', [{ judgement: EQUAL, solves: true }], undefined, 100],
    ['revealed, first try, my move', [{ judgement: MY_MOVE, revealed: true, solves: true }], undefined, 50],
    ['hidden, first try, 0.7 better', [{ judgement: BETTER(0.7), solves: true }], undefined, 150],
    ['revealed, first try, 0.7 better', [{ judgement: BETTER(0.7), revealed: true, solves: true }], undefined, 175],
    ['hidden, a mistake, then my move', [{ judgement: MISTAKE }, { judgement: MY_MOVE, solves: true }], undefined, 40],
    ['revealed, a blunder, then my move', [{ judgement: BLUNDER, revealed: true }, { judgement: MY_MOVE, revealed: true, solves: true }], undefined, 0],
    ['revealed, a blunder, then skip', [{ judgement: BLUNDER, revealed: true }], 'skipped', -30],
    ['skip', [], 'skipped', 0],
  ])('%s', (_name, steps, end, expected) => {
    expect(points(steps, end)).toBe(expected);
  });
});

describe('scorePosition — the breakdown', () => {
  const everyShape: Array<[string, Step[], 'skipped' | 'out_of_tries' | undefined]> = [
    ['my move', [{ judgement: MY_MOVE, solves: true }], undefined],
    ['my move, revealed, third try', [{ judgement: MEH }, { judgement: MISTAKE }, { judgement: MY_MOVE, revealed: true, solves: true }], undefined],
    ['better, revealed, second try', [{ judgement: BLUNDER }, { judgement: BETTER(1.4), revealed: true, solves: true }], undefined],
    ['equal, second try', [{ judgement: MEH }, { judgement: EQUAL, solves: true }], undefined],
    ['capped penalties', [{ judgement: BLUNDER }, { judgement: BLUNDER }, { judgement: MATED }], 'out_of_tries'],
    ['skip after a mistake', [{ judgement: MISTAKE }], 'skipped'],
    ['open', [{ judgement: MISTAKE }], undefined],
  ];

  it.each(everyShape)('adds up to the points: %s', (_name, steps, end) => {
    const score = scored(steps, end);
    expect(score.lines.reduce((sum, l) => sum + l.points, 0)).toBe(score.points);
  });

  it('names what was found and what it was worth', () => {
    expect(scored([{ judgement: MY_MOVE, solves: true }]).lines).toEqual([{ label: 'Found my move', points: 100 }]);
    expect(scored([{ judgement: EQUAL, solves: true }]).lines).toEqual([{ label: 'Found a move as good as mine', points: 100 }]);
  });

  it('shows the halving and the try as their own lines', () => {
    const score = scored([{ judgement: MEH }, { judgement: MY_MOVE, revealed: true, solves: true }]);
    expect(score.lines).toEqual([
      { label: 'Found my move', points: 100 },
      { label: 'Read my thinking first: half', points: -50 },
      { label: 'Try 2 of 3: ×0.6', points: -20 },
    ]);
  });

  it('shows a better move’s bonus, and the extra for finding it after reading my thinking', () => {
    const score = scored([{ judgement: BETTER(0.7), revealed: true, solves: true }]);
    expect(score.lines).toEqual([
      { label: 'Found a move better than mine', points: 100 },
      { label: 'Better than mine by 0.7 pawns', points: 50 },
      { label: 'Found it even after reading my thinking', points: 25 },
    ]);
  });

  it('describes a margin that is a forced mate as that', () => {
    const labels = scored([{ judgement: BETTER(99.7), solves: true }]).lines.map(l => l.label);
    expect(labels).toContain('Better than mine by a forced mate');
  });

  it('names each penalty by the guess that earned it', () => {
    const score = scored([{ san: 'Qh5', judgement: MISTAKE }, { san: 'a3', judgement: MATED }], 'skipped');
    expect(score.lines).toEqual([
      { label: 'Skipped', points: 0 },
      { label: 'Mistake: Qh5', points: -20 },
      { label: 'Walked into a forced mate: a3', points: -40 },
    ]);
    expect(scored([{ san: 'Qh5', judgement: BLUNDER }], 'skipped').lines[1]).toEqual({ label: 'Blunder: Qh5', points: -30 });
    expect(scored([{ san: 'Qh5', judgement: { kind: 'worse', margin: 0, penalty: 10, reason: 'inaccuracy' } }], 'skipped').lines[1])
      .toEqual({ label: 'Inaccuracy: Qh5', points: -10 });
  });

  it('shows no line for a halving or a try that changes nothing', () => {
    const labels = scored([{ judgement: MY_MOVE, solves: true }]).lines.map(l => l.label);
    expect(labels.join()).not.toMatch(/half|Try/);
  });
});

describe('scorePosition — a refund changes the score the way it should', () => {
  it('moves a guess up a try when the one before it is given back', () => {
    const pending = addAttempt(emptyLedger(), { id: 1, san: 'a', revealed: false, status: 'pending' });
    const solved = solve(addAttempt(pending, { id: 2, san: 'b', revealed: false, status: 'rated', judgement: MY_MOVE }), 2);
    expect(scorePosition(solved).points).toBe(60);
    expect(scorePosition(failAttempt(solved, 1)).points).toBe(100);
  });
});

// ─── the whole game ───────────────────────────────────────────────────────────

describe('summarizeScores', () => {
  const score = (outcome: PositionScore['outcome'], pts: number, revealed = false): PositionScore =>
    ({ outcome, revealed, tryNumber: null, points: pts, lines: [] });

  it('totals the points against a flawless blind game', () => {
    const s = summarizeScores([score('mine', 100), score('equal', 50, true), score('skipped', 0), score('better', 150)], 4);
    expect(s).toMatchObject({ positions: 4, total: 300, max: 400, percent: 75 });
  });

  it('counts each way a move ended', () => {
    const s = summarizeScores(
      [score('mine', 100), score('mine', 50, true), score('equal', 100), score('better', 150), score('skipped', 0), score('out_of_tries', -30)], 6,
    );
    expect(s.counts).toEqual({ mine: 2, equal: 1, better: 1, skipped: 1, out_of_tries: 1, open: 0 });
  });

  it('counts solved moves by whether my thinking was open', () => {
    const s = summarizeScores(
      [score('mine', 100), score('equal', 100), score('better', 150), score('mine', 50, true), score('better', 175, true), score('skipped', 0, true)], 6,
    );
    expect(s.blindSolves).toBe(3);
    expect(s.revealedSolves).toBe(2);
  });

  it('counts a move the reader never reached as open', () => {
    const s = summarizeScores([score('mine', 100)], 4);
    expect(s.counts.open).toBe(3);
    expect(s.percent).toBe(25);
  });

  it('counts a move in progress as open, with its penalties so far', () => {
    const s = summarizeScores([score('open', -20)], 1);
    expect(s).toMatchObject({ total: -20, percent: -20 });
    expect(s.counts.open).toBe(1);
  });

  it('can go over 100%: the reader out-thought me', () => {
    expect(summarizeScores([score('better', 200)], 1).percent).toBe(200);
  });

  it('copes with no moves at all', () => {
    expect(summarizeScores([], 0)).toMatchObject({ total: 0, max: 0, percent: 0 });
  });

  it('works from real ledgers', () => {
    const s = summarizeScores(
      [
        scorePosition(play([{ judgement: MY_MOVE, solves: true }])),
        scorePosition(play([{ judgement: BLUNDER }, { judgement: BETTER(0.7), revealed: true, solves: true }])),
        scorePosition(play([], 'skipped')),
      ],
      3,
    );
    expect(s.total).toBe(100 + (Math.round(175 * 0.6) - 30) + 0);
    expect(s.counts).toMatchObject({ mine: 1, better: 1, skipped: 1 });
  });
});
