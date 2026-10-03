/**
 * Client-side driver for the AI "thinking" analysis of a game's journal entries.
 *
 * The server analyses ONE entry per request (each needs its own function
 * invocation and time budget), so the browser loops over the entries. That loop
 * used to abort the whole run on the first bad response, and it reported
 * success even when the server said an entry had failed — leaving moves
 * silently without comments. This version:
 *   - retries transient failures (rate limit, overload, timeout, network),
 *   - keeps going past an entry it can't analyse instead of abandoning the rest,
 *   - returns exactly which entries failed and why, so the UI can say so.
 *
 * fetch and sleep are injectable so the logic is testable without a browser.
 */

export interface EntryFailure {
  /** Position of the entry in the game's (chronologically ordered) journal entries. */
  index: number;
  error: string;
}

export interface ThinkingRunResult {
  /** Number of journal entries for the game, once the server has told us. */
  total: number | null;
  analyzed: number;
  /** Entries with no text to analyse — expected, not a failure. */
  skipped: number;
  failures: EntryFailure[];
  /** Set when the run could not continue at all. */
  fatal?: string;
}

export interface ThinkingRunOptions {
  gameId: string;
  /** Re-run only these entry positions (the retry pass). Omit to run the whole game. */
  indices?: number[];
  onProgress?: (done: number, total: number) => void;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 6_000];
// The server gives up on its own work at 55 s; leave room for the reply to arrive.
const REQUEST_TIMEOUT_MS = 75_000;

type EntryStatus = 'analyzed' | 'skipped' | 'failed';

type EntryOutcome =
  | { kind: 'done'; status: EntryStatus; completed: boolean; nextEntryIndex: number; totalEntries: number | null; error?: string }
  | { kind: 'failed'; error: string } // the request itself kept failing
  | { kind: 'fatal'; error: string }; // retrying can't help (bad request, engine analysis missing, …)

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function requestEntry(
  gameId: string,
  entryIndex: number,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
): Promise<EntryOutcome> {
  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleepFn(RETRY_DELAYS_MS[attempt - 2]);
    const isLastAttempt = attempt === MAX_ATTEMPTS;

    try {
      const response = await fetchFn('/api/games/analyze-thinking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, reanalyzeEngine: false, entryIndex }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null);

      // A platform timeout answers with an HTML/plain-text page, not JSON.
      if (!data) {
        lastError = `The server sent an unreadable response (HTTP ${response.status}) — most likely it timed out`;
        continue;
      }
      if (data.needsEngineAnalysis) {
        return { kind: 'fatal', error: data.message || 'Engine analysis is required first' };
      }

      if (response.ok && data.success) {
        const status: EntryStatus = data.entryStatus ?? 'analyzed';
        if (status === 'failed') {
          lastError = data.error || 'The AI request failed';
          if (data.retryable !== false && !isLastAttempt) continue;
        }
        return {
          kind: 'done',
          status,
          completed: !!data.completed,
          nextEntryIndex: typeof data.nextEntryIndex === 'number' ? data.nextEntryIndex : entryIndex + 1,
          totalEntries: typeof data.totalEntries === 'number' ? data.totalEntries : null,
          ...(status === 'failed' ? { error: lastError } : {}),
        };
      }

      lastError = data.error || `The server returned HTTP ${response.status}`;
      // A 4xx other than "slow down / timed out" means the request itself is wrong.
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        return { kind: 'fatal', error: lastError };
      }
    } catch (error) {
      lastError =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'The request timed out'
          : error instanceof Error
            ? error.message
            : String(error);
    }
  }

  return { kind: 'failed', error: lastError };
}

/**
 * Analyse a game's journal entries one request at a time. Never throws:
 * everything that went wrong is in the returned result.
 */
export async function runThinkingAnalysis(options: ThinkingRunOptions): Promise<ThinkingRunResult> {
  const { gameId, indices, onProgress } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;

  const result: ThinkingRunResult = { total: null, analyzed: 0, skipped: 0, failures: [] };
  let next = 0; // cursor for the whole-game pass
  let position = 0; // cursor for the retry pass

  while (true) {
    const index = indices ? indices[position] : next;
    if (index === undefined) break;
    position++;

    const outcome = await requestEntry(gameId, index, fetchFn, sleepFn);

    if (outcome.kind === 'fatal') {
      result.fatal = outcome.error;
      // The entries we never got to still have no comment — don't lose track of them.
      if (indices) {
        for (const rest of indices.slice(position - 1)) result.failures.push({ index: rest, error: outcome.error });
      }
      break;
    }

    if (outcome.kind === 'failed') {
      result.failures.push({ index, error: outcome.error });
      if (!indices) {
        // Without a total we can't tell where the list ends, so we can't skip past this entry.
        if (result.total === null) {
          result.fatal = outcome.error;
          break;
        }
        next = index + 1;
        if (next >= result.total) break;
      }
    } else {
      if (outcome.totalEntries !== null) result.total = outcome.totalEntries;
      if (outcome.status === 'analyzed') result.analyzed++;
      else if (outcome.status === 'skipped') result.skipped++;
      else result.failures.push({ index, error: outcome.error ?? 'The AI request failed' });

      if (!indices) {
        if (outcome.completed) {
          onProgress?.(index + 1, result.total ?? index + 1);
          break;
        }
        next = outcome.nextEntryIndex;
      }
    }

    if (indices) onProgress?.(position, indices.length);
    else onProgress?.(index + 1, result.total ?? index + 1);
  }

  return result;
}

/** Combine a whole-game pass with the retry pass that followed it. */
export function mergeRetry(first: ThinkingRunResult, retry: ThinkingRunResult): ThinkingRunResult {
  return {
    total: first.total,
    analyzed: first.analyzed + retry.analyzed,
    skipped: first.skipped + retry.skipped,
    // The retry pass re-ran every failed index, so its failures are the complete remaining list.
    failures: retry.failures,
    fatal: retry.fatal,
  };
}

/** What to tell the user when a run is over. */
export function summarizeRun(result: ThinkingRunResult): { ok: boolean; message: string } {
  if (result.fatal) {
    const done = result.analyzed > 0 ? ` ${result.analyzed} entries were analysed before it stopped.` : '';
    return { ok: false, message: `AI analysis stopped: ${result.fatal}.${done}` };
  }
  if (result.failures.length === 0) {
    return { ok: true, message: '🧠 AI analysis complete!' };
  }
  const n = result.failures.length;
  const of = result.total !== null ? ` of ${result.total}` : '';
  return {
    ok: false,
    message:
      `AI analysis finished, but ${n}${of} ${n === 1 ? 'entry has' : 'entries have'} no AI comment: ` +
      `${result.failures[0].error}. Run "Analyze thinking" again to fill ${n === 1 ? 'it' : 'them'} in.`,
  };
}
