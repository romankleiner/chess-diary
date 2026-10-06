/**
 * Scoring a reader's guesses on the blog. Pure logic, safe for the browser.
 *
 * Each move the reader is asked to guess is scored on its own, from the guesses
 * made at it (the "ledger") and whether my thinking was open when they were made:
 *
 *   - my move, or one the engine rates the same (within the engine's noise): 100
 *   - a move better than mine: 100, plus 25-100 by how much better
 *   - after revealing my thinking, my move (or its equal) is worth half; a move
 *     better than mine, found despite having read it, is worth 25 more
 *   - 3 tries; the points are x1, x0.6, x0.3 for the first, second, third
 *   - skipping, or running out of tries: 0
 *   - a rated guess worse than my move costs points by how far it sits behind the
 *     engine's top line (more than 0.5 pawns: 10, more than 1: 20, more than 2:
 *     30, walking into a forced mate: 40), up to 60 per move. Revealing my
 *     thinking changes none of that, and a move at least as good as mine is
 *     never penalised.
 *
 * Everything is derived from the ledger, so a rating that arrives late (the
 * engine answers after the reader has moved on) changes the score the way it
 * would have had it arrived at once.
 */
import { getMoveQuality } from './analysis-utils';
import { MATE_THRESHOLD_PAWNS, isMatePawns, roundPawns } from './position-eval';
import type { GuessComparison } from './guess-eval';

// ─── The rules ────────────────────────────────────────────────────────────────

export const MAX_TRIES = 3;
/** Share of the solving points kept on the first, second and third try. */
export const TRY_MULTIPLIERS = [1, 0.6, 0.3] as const;
/** Finding my move, or a move as good as it, thinking hidden, first try. */
export const MATCH_POINTS = 100;
/** The share of a match kept when my thinking was revealed first. */
export const REVEALED_MATCH_SHARE = 0.5;
/** Beating my move after reading my thinking: the extra for finding better regardless. */
export const DESPITE_ME_POINTS = 25;
/** The most one move can cost the reader in penalties. */
export const PENALTY_CAP = 60;
export const MATE_PENALTY = 40;

/** Penalty by the label the engine check shows for the guess (see getMoveQuality). */
export const PENALTY_BY_QUALITY: Record<string, number> = { inaccuracy: 10, mistake: 20, blunder: 30 };

/** Bonus for beating my move: up to the first limit (in pawns), then the next, and so on. */
const MARGIN_TIERS: ReadonlyArray<{ under: number; points: number }> = [
  { under: 0.5, points: 25 },
  { under: 1, points: 50 },
  { under: 2, points: 75 },
];
const TOP_MARGIN_POINTS = 100;
/** The smallest and the largest bonus for beating my move. */
export const MIN_MARGIN_BONUS = MARGIN_TIERS[0].points;
export const MAX_MARGIN_BONUS = TOP_MARGIN_POINTS;

/** The bonus for a guess that beats my move by `margin` pawns, rounded to one decimal. */
export function marginBonus(margin: number): number {
  for (const tier of MARGIN_TIERS) if (margin < tier.under) return tier.points;
  return TOP_MARGIN_POINTS;
}

// ─── Judging one guess ────────────────────────────────────────────────────────

/** How a guess compares with my move: the same move, as good, better, or worse. */
export type GuessKind = 'mine' | 'equal' | 'better' | 'worse';
export type PenaltyReason = 'inaccuracy' | 'mistake' | 'blunder' | 'mate';

export interface GuessJudgement {
  kind: GuessKind;
  /** For 'better': pawns above my move, rounded to one decimal. A forced mate is far beyond any tier. */
  margin: number;
  /** Points lost for a bad guess; 0 for anything else. */
  penalty: number;
  reason: PenaltyReason | null;
}

/** Playing my own move needs no comparison. */
export const MY_MOVE: GuessJudgement = { kind: 'mine', margin: 0, penalty: 0, reason: null };

/** Judge a rated guess that was not my move. */
export function judgeGuess(comparison: GuessComparison): GuessJudgement {
  if (comparison.vsMine === 'same') return { kind: 'equal', margin: 0, penalty: 0, reason: null };
  if (comparison.vsMine === 'better') {
    return { kind: 'better', margin: roundPawns(comparison.guess - comparison.mine), penalty: 0, reason: null };
  }

  // Worse than mine. Walking into a mate is the worst of it -- unless the engine
  // sees mate against the reader whatever they play, when it is nobody's blunder.
  const mated = isMatePawns(comparison.guess) && comparison.guess < 0;
  const matedAnyway = isMatePawns(comparison.top) && comparison.top < 0;
  if (mated && !matedAnyway) return { kind: 'worse', margin: 0, penalty: MATE_PENALTY, reason: 'mate' };

  const quality = getMoveQuality(Math.round(comparison.lossVsTop * 100));
  const penalty = PENALTY_BY_QUALITY[quality] ?? 0;
  return {
    kind: 'worse',
    margin: 0,
    penalty,
    reason: penalty > 0 ? (quality as PenaltyReason) : null,
  };
}

// ─── The ledger: what the reader has tried at one move ────────────────────────

/**
 *  pending  — played; the engine has not answered
 *  rated    — judged (a guess that is my move is rated at once)
 *  unrated  — played where there is no engine check to judge it by
 *  failed   — the engine could not be reached; the try is given back
 */
export type AttemptStatus = 'pending' | 'rated' | 'unrated' | 'failed';

export interface Attempt {
  /** Unique at this move; the order the guesses were played in. */
  id: number;
  san: string;
  /** My thinking was open when the guess was played. */
  revealed: boolean;
  status: AttemptStatus;
  judgement: GuessJudgement | null;
}

export type Ending =
  | { how: 'solved'; attemptId: number }
  | { how: 'skipped' }
  | { how: 'out_of_tries' };

export interface Ledger {
  attempts: readonly Attempt[];
  ending: Ending | null;
}

export const emptyLedger = (): Ledger => ({ attempts: [], ending: null });

/** The same rule as normSan in components/blog-shared: check marks and case don't make a different move. */
const sameMove = (a: string, b: string) => normalize(a) === normalize(b);
const normalize = (san: string) => san.replace(/[+#?!]/g, '').trim().toLowerCase();

const counted = (attempt: Attempt) => attempt.status !== 'failed';

export const triesUsed = (ledger: Ledger): number => ledger.attempts.filter(counted).length;
export const triesLeft = (ledger: Ledger): number => Math.max(0, MAX_TRIES - triesUsed(ledger));
export const hasPending = (ledger: Ledger): boolean => ledger.attempts.some(a => a.status === 'pending');

/** Whether this move was already tried, which doesn't cost another try. */
export const hasTried = (ledger: Ledger, san: string): boolean =>
  ledger.attempts.some(a => counted(a) && sameMove(a.san, san));

/**
 * All tries are spent and the engine has answered for every one, so nothing can
 * still solve the move: it is over. (While an answer is outstanding the last guess
 * might yet turn out to be as good as mine.)
 */
export const isOutOfTries = (ledger: Ledger): boolean =>
  ledger.ending === null && triesLeft(ledger) === 0 && !hasPending(ledger);

/** Which try this guess was: 1 for the first, counting only guesses that used a try. */
export function tryNumber(ledger: Ledger, attemptId: number): number {
  const before = ledger.attempts.findIndex(a => a.id === attemptId);
  return 1 + ledger.attempts.slice(0, Math.max(0, before)).filter(counted).length;
}

const update = (ledger: Ledger, attemptId: number, change: (a: Attempt) => Attempt): Ledger => {
  const at = ledger.attempts.findIndex(a => a.id === attemptId);
  if (at < 0) return ledger;
  const next = change(ledger.attempts[at]);
  if (next === ledger.attempts[at]) return ledger;
  return { ...ledger, attempts: ledger.attempts.map((a, i) => (i === at ? next : a)) };
};

/** Only a rated guess carries a judgement, whatever else is passed: that is what lets the rest trust one. */
export function addAttempt(
  ledger: Ledger,
  attempt: { id: number; san: string; revealed: boolean; status: Exclude<AttemptStatus, 'failed'>; judgement?: GuessJudgement | null },
): Ledger {
  if (ledger.ending || ledger.attempts.some(a => a.id === attempt.id)) return ledger;
  const judgement = attempt.status === 'rated' ? attempt.judgement ?? null : null;
  return { ...ledger, attempts: [...ledger.attempts, { ...attempt, judgement }] };
}

/** The engine answered for a pending guess. */
export const rateAttempt = (ledger: Ledger, attemptId: number, judgement: GuessJudgement): Ledger =>
  update(ledger, attemptId, a => (a.status === 'pending' ? { ...a, status: 'rated', judgement } : a));

/** The engine could not be reached for a pending guess: it was not the reader's fault, so the try is given back. */
export const failAttempt = (ledger: Ledger, attemptId: number): Ledger =>
  update(ledger, attemptId, a => (a.status === 'pending' ? { ...a, status: 'failed' } : a));

/** This guess solved the move. Only a rated guess (the only kind with a judgement) that is not worse than mine can. */
export function solve(ledger: Ledger, attemptId: number): Ledger {
  if (ledger.ending) return ledger;
  const attempt = ledger.attempts.find(a => a.id === attemptId);
  if (!attempt || !attempt.judgement || attempt.judgement.kind === 'worse') return ledger;
  return { ...ledger, ending: { how: 'solved', attemptId } };
}

/** The reader gave up on the move, or ran out of tries. */
export function giveUp(ledger: Ledger, how: 'skipped' | 'out_of_tries'): Ledger {
  return ledger.ending ? ledger : { ...ledger, ending: { how } };
}

// ─── Scoring a move ───────────────────────────────────────────────────────────

export type PositionOutcome = 'mine' | 'equal' | 'better' | 'skipped' | 'out_of_tries' | 'open';

export interface ScoreLine {
  label: string;
  /** Signed; the lines add up to the move's points. */
  points: number;
}

export interface PositionScore {
  outcome: PositionOutcome;
  /** My thinking was open when the solving guess was played. */
  revealed: boolean;
  /** Which try solved it, when it was solved. */
  tryNumber: number | null;
  points: number;
  lines: ScoreLine[];
}

const REASON_LABEL: Record<PenaltyReason, string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  mate: 'Walked into a forced mate',
};

/** A margin in words; one that large is a forced mate (found, or the one I walked into). */
const describeMargin = (margin: number) => (margin >= MATE_THRESHOLD_PAWNS ? 'a forced mate' : `${margin.toFixed(1)} pawns`);

export function scorePosition(ledger: Ledger): PositionScore {
  const lines: ScoreLine[] = [];
  let running = 0;
  // Each line is the change to the running total, so the lines always add up to
  // the total however the rounding falls.
  const add = (label: string, points: number) => {
    lines.push({ label, points });
    running += points;
  };
  /** A line that scales the running total, rounded to whole points. */
  const scale = (label: string, factor: number) => add(label, Math.round(running * factor) - running);

  const ending = ledger.ending;
  const solving = ending?.how === 'solved'
    ? ledger.attempts.find(a => a.id === ending.attemptId && a.judgement && a.judgement.kind !== 'worse')
    : undefined;
  const judgement = solving?.judgement ?? null;

  let outcome: PositionOutcome = 'open';
  let revealed = false;
  let tries: number | null = null;

  if (solving && judgement) {
    revealed = solving.revealed;
    tries = tryNumber(ledger, solving.id);
    outcome = judgement.kind === 'mine' ? 'mine' : judgement.kind === 'equal' ? 'equal' : 'better';

    if (judgement.kind === 'better') {
      add('Found a move better than mine', MATCH_POINTS);
      add(`Better than mine by ${describeMargin(judgement.margin)}`, marginBonus(judgement.margin));
      if (revealed) add('Found it even after reading my thinking', DESPITE_ME_POINTS);
    } else {
      add(judgement.kind === 'mine' ? 'Found my move' : 'Found a move as good as mine', MATCH_POINTS);
      if (revealed) scale('Read my thinking first: half', REVEALED_MATCH_SHARE);
    }
    const multiplier = TRY_MULTIPLIERS[Math.min(tries, TRY_MULTIPLIERS.length) - 1];
    if (multiplier !== 1) scale(`Try ${tries} of ${MAX_TRIES}: ×${multiplier}`, multiplier);
  } else if (ending?.how === 'skipped') {
    outcome = 'skipped';
    lines.push({ label: 'Skipped', points: 0 });
  } else if (ending?.how === 'out_of_tries') {
    outcome = 'out_of_tries';
    lines.push({ label: 'Out of tries', points: 0 });
  }

  // Bad guesses cost the same however the move ended, and whether or not my
  // thinking was open. A guess still waiting for the engine costs nothing yet.
  let owed = 0;
  for (const attempt of ledger.attempts) {
    const j = attempt.judgement;
    if (!j || j.kind !== 'worse' || j.penalty === 0 || !j.reason) continue;
    add(`${REASON_LABEL[j.reason]}: ${attempt.san}`, -j.penalty);
    owed += j.penalty;
  }
  if (owed > PENALTY_CAP) add(`Penalties capped at −${PENALTY_CAP}`, owed - PENALTY_CAP);

  return { outcome, revealed, tryNumber: tries, points: running, lines };
}

// ─── The whole game ───────────────────────────────────────────────────────────

export interface ScoreSummary {
  /** Moves the reader was asked to guess. */
  positions: number;
  total: number;
  /** What a flawless blind game scores: my move every time, thinking hidden, first try. */
  max: number;
  /** Total against max, in whole percent; above 100 means the reader out-thought me. */
  percent: number;
  counts: Record<PositionOutcome, number>;
  /** Moves solved without opening my thinking, and moves solved after reading it. */
  blindSolves: number;
  revealedSolves: number;
}

export function summarizeScores(scores: readonly PositionScore[], positions: number): ScoreSummary {
  const counts: Record<PositionOutcome, number> = { mine: 0, equal: 0, better: 0, skipped: 0, out_of_tries: 0, open: 0 };
  let total = 0, blindSolves = 0, revealedSolves = 0;
  for (const score of scores) {
    counts[score.outcome]++;
    total += score.points;
    if (score.outcome === 'mine' || score.outcome === 'equal' || score.outcome === 'better') {
      if (score.revealed) revealedSolves++; else blindSolves++;
    }
  }
  // A move the reader never reached has no score yet
  counts.open += Math.max(0, positions - scores.length);

  const max = positions * MATCH_POINTS;
  return {
    positions,
    total,
    max,
    percent: max > 0 ? Math.round((total / max) * 100) : 0,
    counts,
    blindSolves,
    revealedSolves,
  };
}
