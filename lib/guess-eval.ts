/**
 * Rating a reader's guess on the blog: how the position after THEIR move
 * evaluates, next to the position after MY move and the engine's top line.
 * Pure logic, safe for the browser.
 *
 * Where each number comes from:
 *   - the reader's move: evaluated live (see fetchGuessEval);
 *   - my move: the engine check already stored with the blog section;
 *   - the engine's top line: not stored directly, but my move's evaluation plus
 *     the centipawn loss it was recorded with gives it back (the same
 *     reconstruction the AI analysis uses for "the position before the move").
 *
 * Everything shown is rounded to one decimal, like the engine check beside it,
 * and the comparisons are made on those rounded values so the sentence never
 * disagrees with the numbers printed above it.
 */
import { getMoveQuality } from './analysis-utils';
import { MATE_PAWNS, isMatePawns, roundPawns, terminalEval } from './position-eval';
import type { PositionEval } from './position-eval';

export type PlayerColor = 'white' | 'black';

/** Differences up to this are "about the same" -- engines wobble by about a tenth between runs. */
const SAME_WITHIN_PAWNS = 0.1;

const round1 = roundPawns;

/** Positive always means good for the player, whichever colour they are. */
export function playerPawns(whitePawns: number, color: PlayerColor): number {
  return color === 'white' ? whitePawns : -whitePawns;
}

/**
 * The evaluation after the engine's top move, from White's point of view,
 * rebuilt from my move's evaluation and how many centipawns it fell short.
 */
export function topLinePawns(
  engine: { evaluation: number; centipawnLoss: number },
  color: PlayerColor,
): number {
  const shift = engine.centipawnLoss / 100;
  const top = color === 'white' ? engine.evaluation + shift : engine.evaluation - shift;
  return Math.max(-MATE_PAWNS, Math.min(MATE_PAWNS, top));
}

export interface GuessComparison {
  /** From the player's point of view, rounded to one decimal. */
  guess: number;
  mine: number;
  top: number;
  /** How far the guess falls short of the top line, in pawns; never negative. */
  lossVsTop: number;
  /** Same labels as the engine check on my own move: excellent … blunder. */
  quality: string;
  /** One line on the guess against the engine's top line. */
  headline: string;
  /** One line on the guess against my move. */
  versusMine: string;
  /**
   * The same judgement as `versusMine`, as a value to act on. "better" is
   * beyond the engine's noise, so a guess that only ties my move is "same".
   */
  vsMine: VersusMine;
}

export type VersusMine = 'better' | 'same' | 'worse';

export function compareGuess({ guess, mine, top, color }: {
  guess: PositionEval;
  /** My move's evaluation, White's point of view. */
  mine: number;
  /** The top line's evaluation, White's point of view. */
  top: number;
  color: PlayerColor;
}): GuessComparison {
  const g = round1(playerPawns(guess.pawns, color));
  const m = round1(playerPawns(mine, color));
  const t = round1(playerPawns(top, color));

  const loss = Math.max(0, round1(t - g));
  const guessMates = isMatePawns(g) && g > 0;
  const guessMated = isMatePawns(g) && g < 0;
  const mineMates = isMatePawns(m) && m > 0;
  const mineMated = isMatePawns(m) && m < 0;
  const topMates = isMatePawns(t) && t > 0;
  const topMated = isMatePawns(t) && t < 0;

  let headline: string;
  if (guessMates) headline = topMates ? 'Finds the forced mate' : 'Finds a forced mate';
  else if (guessMated) headline = topMated ? 'A forced mate against you either way' : 'Walks into a forced mate';
  else if (topMates) headline = 'Misses a forced mate';
  else if (loss === 0) headline = g > t ? "At least as good as the engine's top line" : "Matches the engine's top line";
  else headline = `${loss.toFixed(1)} behind the engine's top line`;

  // One judgement, put into words and into a value together, so the sentence
  // on the card and the decision to move on can't disagree.
  let versusMine: string;
  let vsMine: VersusMine;
  if (guessMates && mineMates) [vsMine, versusMine] = ['same', 'Also a forced mate, like mine'];
  else if (guessMates) [vsMine, versusMine] = ['better', 'Better than my move — it finds a forced mate'];
  else if (mineMates) [vsMine, versusMine] = ['worse', 'Worse than my move — I had a forced mate'];
  else if (guessMated && !mineMated) [vsMine, versusMine] = ['worse', 'Worse than my move — it walks into a forced mate'];
  else if (mineMated && !guessMated) [vsMine, versusMine] = ['better', 'Better than my move — I walked into a forced mate'];
  else {
    const diff = round1(g - m);
    if (Math.abs(diff) <= SAME_WITHIN_PAWNS + 1e-9) [vsMine, versusMine] = ['same', 'About the same as my move'];
    else if (diff > 0) [vsMine, versusMine] = ['better', `Better than my move by ${diff.toFixed(1)}`];
    else [vsMine, versusMine] = ['worse', `Worse than my move by ${(-diff).toFixed(1)}`];
  }

  return {
    guess: g,
    mine: m,
    top: t,
    lossVsTop: loss,
    quality: getMoveQuality(Math.round(loss * 100)),
    headline,
    versusMine,
    vsMine,
  };
}

/**
 * Whether a rated guess earns the move on, as if the reader had found mine: it
 * must be at least as good as my move, to within the engine's noise (a guess
 * that only ties mine counts, one that beats it counts for more). A guess is
 * rated when the engine answers, which can be after the reader has done
 * something else, so the answer only counts while the move is still open
 * (solving it unlocks the next one, which must happen once) and its card is
 * still on the page. The engine's own top move is accepted separately, at once,
 * so it is left out here.
 */
export function earnsMoveOn({ comparison, isEngineBest, alreadySolved, stillOnPage }: {
  comparison: Pick<GuessComparison, 'vsMine'>;
  isEngineBest: boolean;
  alreadySolved: boolean;
  stillOnPage: boolean;
}): boolean {
  return comparison.vsMine !== 'worse' && !isEngineBest && !alreadySolved && stillOnPage;
}

/** What the blog stores about my move's engine check, as far as rating a guess needs it. */
export interface GuessBaseline {
  evaluation: number;
  centipawnLoss: number;
  depth?: number | null;
}

export interface GuessRating {
  /** The position after the reader's move, White's point of view. */
  guessEval: PositionEval;
  comparison: GuessComparison;
}

/**
 * Rate a guess that IS the engine's top move. There is nothing to ask the
 * engine: the evaluation after it is the top line's, worked out from my move's.
 * So this answers at once, which lets the reader be scored on the spot.
 */
export function rateEngineBest({ engine, color }: {
  engine: GuessBaseline;
  color: PlayerColor;
}): GuessRating {
  const top = topLinePawns(engine, color);
  const guessEval: PositionEval = { pawns: top, mate: null, depth: null };
  return { guessEval, comparison: compareGuess({ guess: guessEval, mine: engine.evaluation, top, color }) };
}

/**
 * Rate one guess against my move and the engine's top line.
 *
 * When the guess IS the engine's top move there is nothing to ask (see
 * rateEngineBest). Anything else is evaluated live, as deeply as the stored
 * analysis was run so the numbers are comparable.
 */
export async function rateGuess({ fenAfterGuess, isEngineBest, engine, color, fetchFn }: {
  fenAfterGuess: string;
  isEngineBest: boolean;
  engine: GuessBaseline;
  color: PlayerColor;
  fetchFn?: typeof fetch;
}): Promise<GuessRating> {
  if (isEngineBest) return rateEngineBest({ engine, color });
  const top = topLinePawns(engine, color);
  const guessEval = await fetchGuessEval(fenAfterGuess, engine.depth, fetchFn);
  return { guessEval, comparison: compareGuess({ guess: guessEval, mine: engine.evaluation, top, color }) };
}

/**
 * Evaluate the position after a reader's move. Finished games are answered
 * locally; everything else asks /api/eval. Throws if no evaluation comes back.
 */
export async function fetchGuessEval(
  fenAfterMove: string,
  depth?: number | null,
  fetchFn: typeof fetch = fetch,
): Promise<PositionEval> {
  const finished = terminalEval(fenAfterMove);
  if (finished) return finished;

  const params = new URLSearchParams({ fen: fenAfterMove });
  if (depth) params.set('depth', String(depth));

  const response = await fetchFn(`/api/eval?${params}`, { signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `The server returned ${response.status}`);
  }
  if (!body || typeof body.pawns !== 'number' || !Number.isFinite(body.pawns)) {
    throw new Error('The server sent back an unreadable evaluation');
  }
  return { pawns: body.pawns, mate: typeof body.mate === 'number' ? body.mate : null, depth: body.depth ?? null };
}
