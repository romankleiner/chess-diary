/**
 * The scoring game's display: tries left, how a move was scored, the score at
 * the end of the game, and the rules. Presentational only -- every number comes
 * from lib/guess-score.ts, so the text can't drift from the rules it describes.
 */

import {
  DESPITE_ME_POINTS, MATCH_POINTS, MATE_PENALTY, MAX_MARGIN_BONUS, MAX_TRIES, MIN_MARGIN_BONUS, PENALTY_BY_QUALITY,
  PENALTY_CAP, REVEALED_MATCH_SHARE, TRY_MULTIPLIERS,
} from '@/lib/guess-score';
import type { PositionOutcome, PositionScore, ScoreSummary } from '@/lib/guess-score';

/** A score with a proper minus sign. */
export const formatPoints = (points: number): string => (points < 0 ? `−${Math.abs(points)}` : String(points));
/** A change to a score, always signed. */
const formatChange = (points: number): string => (points > 0 ? `+${points}` : formatPoints(points));

export const OUTCOME_LABEL: Record<PositionOutcome, string> = {
  mine: 'Found my move',
  equal: 'Found a move as good as mine',
  better: 'Found a move better than mine',
  skipped: 'Skipped',
  out_of_tries: 'Out of tries',
  open: 'Not played',
};

const pointsColor = (points: number) =>
  points > 0 ? 'text-green-700 dark:text-green-400'
  : points < 0 ? 'text-red-700 dark:text-red-400'
  : 'text-gray-600 dark:text-gray-400';

// ─── Tries left ───────────────────────────────────────────────────────────────

export function TriesLeft({ left, total = MAX_TRIES }: { left: number; total?: number }) {
  return (
    <div
      role="img"
      aria-label={`${left} of ${total} tries left`}
      className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400"
    >
      <span aria-hidden="true">Tries</span>
      <span aria-hidden="true" className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            data-try={i < left ? 'left' : 'used'}
            className={`h-2.5 w-2.5 rounded-full ${
              i < left
                ? 'bg-purple-600 dark:bg-purple-400'
                : 'border border-gray-500 dark:border-gray-400'
            }`}
          />
        ))}
      </span>
    </div>
  );
}

// ─── One move's score ─────────────────────────────────────────────────────────

export function ScoreBreakdown({ score, pending = false }: {
  score: PositionScore;
  /** A guess is still waiting for the engine, and may yet cost points. */
  pending?: boolean;
}) {
  return (
    <div
      role="status"
      aria-label="Your score for this move"
      data-score-breakdown
      className="rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 border-l-purple-400 dark:border-l-purple-500 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Your score for this move</span>
        <span data-score-total className="text-lg font-semibold tabular-nums text-purple-700 dark:text-purple-300">
          {formatPoints(score.points)}
        </span>
      </div>
      <dl className="space-y-1">
        {score.lines.map((line, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-base">
            <dt className="text-gray-700 dark:text-gray-300">{line.label}</dt>
            <dd className={`font-mono font-semibold tabular-nums shrink-0 ${pointsColor(line.points)}`}>
              {formatChange(line.points)}
            </dd>
          </div>
        ))}
      </dl>
      {pending && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Still checking one of your earlier guesses — if it was a poor move, its penalty will be added.
        </p>
      )}
    </div>
  );
}

// ─── The score at the end ─────────────────────────────────────────────────────

export interface ScoreRow {
  /** Shown as the move's name; masked while the move is still locked. */
  header: string;
  score: PositionScore | null;
}

export function ScoreCard({ summary, rows }: { summary: ScoreSummary; rows: ScoreRow[] }) {
  const counts: Array<[string, number]> = [
    [OUTCOME_LABEL.mine, summary.counts.mine],
    [OUTCOME_LABEL.equal, summary.counts.equal],
    [OUTCOME_LABEL.better, summary.counts.better],
    [OUTCOME_LABEL.skipped, summary.counts.skipped],
    [OUTCOME_LABEL.out_of_tries, summary.counts.out_of_tries],
    [OUTCOME_LABEL.open, summary.counts.open],
    ['Solved without reading my thinking', summary.blindSolves],
    ['Solved after reading my thinking', summary.revealedSolves],
  ];

  return (
    <div
      data-score-card
      className="border border-purple-200 dark:border-purple-700 rounded-lg overflow-hidden"
    >
      <div className="bg-purple-50 dark:bg-purple-900/20 px-4 py-3 border-b border-purple-200 dark:border-purple-700">
        <span className="font-semibold text-base text-purple-800 dark:text-purple-300">🏆 Your score</span>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span data-score-total className="text-3xl font-bold tabular-nums text-purple-700 dark:text-purple-300">
              {formatPoints(summary.total)}
            </span>
            <span className="text-base text-gray-700 dark:text-gray-300">
              out of {summary.max} · {formatPoints(summary.percent)}%
            </span>
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {summary.max} is a flawless game: my move on every try, without reading my thinking.
          </p>
          {summary.percent > 100 && (
            <p className="mt-1 text-base font-medium text-blue-700 dark:text-blue-400">
              ⭐ You out-thought the author.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {counts.filter(([, n]) => n > 0).map(([label, n]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 text-base">
              <dt className="text-gray-700 dark:text-gray-300">{label}</dt>
              <dd className="font-mono font-semibold tabular-nums text-gray-900 dark:text-gray-100">{n}</dd>
            </div>
          ))}
        </dl>

        <ol className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
          {rows.map((row, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-base">
              <span className="min-w-0 text-gray-800 dark:text-gray-200">
                {row.header}
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                  {OUTCOME_LABEL[row.score?.outcome ?? 'open']}
                </span>
              </span>
              <span className={`font-mono font-semibold tabular-nums shrink-0 ${pointsColor(row.score?.points ?? 0)}`}>
                {formatPoints(row.score?.points ?? 0)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── The rules ────────────────────────────────────────────────────────────────

export function ScoreLegend() {
  const [, second, third] = TRY_MULTIPLIERS;
  const penalty = PENALTY_BY_QUALITY;
  return (
    <details data-score-legend className="max-w-3xl text-base text-gray-700 dark:text-gray-300">
      <summary className="cursor-pointer text-sm font-medium text-purple-700 dark:text-purple-300 hover:underline underline-offset-2">
        How scoring works
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
        <li>
          Find my move, or a move the engine rates just as well: <strong>{MATCH_POINTS}</strong>. Find a move it
          rates <em>better</em> than mine: {MATCH_POINTS} plus {MIN_MARGIN_BONUS}–{MAX_MARGIN_BONUS} more, the more
          so the better it is.
        </li>
        <li>
          Read my thinking first, and finding my move is worth {Math.round(REVEALED_MATCH_SHARE * 100)}%. Find a
          better move anyway and you get {DESPITE_ME_POINTS} extra.
        </li>
        <li>
          You have {MAX_TRIES} tries at each move: a find on the second try scores {Math.round(second * 100)}% of the
          above, on the third {Math.round(third * 100)}%. Skip a move, or run out of tries, and it scores 0.
        </li>
        <li>
          A guess worse than my move costs points when it is far behind the engine&apos;s top line: {penalty.inaccuracy} for
          more than half a pawn (an inaccuracy), {penalty.mistake} for more than one (a mistake), {penalty.blunder} for more than
          two (a blunder), {MATE_PENALTY} for walking into a forced mate — at most {PENALTY_CAP} a move. Reading my thinking
          doesn&apos;t change that.
        </li>
      </ul>
    </details>
  );
}
