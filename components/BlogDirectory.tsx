'use client';

/**
 * The public directory of shared game blogs: every game, newest first, by month,
 * each opening its blog. A search box and a result filter narrow the list. The
 * entries arrive already read and ordered (see lib/blog-directory-server.ts);
 * what a row says and how the list is filtered is lib/blog-directory.ts.
 * On the author's own directory each game can also be un-shared from here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PlayerLink, ResultBadge } from '@/components/blog-shared';
import { formatPlayer } from '@/lib/players';
import {
  NO_FILTER, describeCommentary, filterDirectory, formatDateRange, groupByMonth, tallyResults,
} from '@/lib/blog-directory';
import type { DirectoryEntry, DirectoryFilter } from '@/lib/blog-directory';
import { DIRECTORY_KEY_STORAGE } from '@/lib/directory-key';
import { blogPath } from '@/lib/blog-link';

const RESULT_FILTERS: Array<{ value: DirectoryFilter['result']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'win', label: 'Wins' },
  { value: 'draw', label: 'Draws' },
  { value: 'loss', label: 'Losses' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const gameTitle = (entry: DirectoryEntry) =>
  `${formatPlayer(entry.white, entry.whiteRating)} vs ${formatPlayer(entry.black, entry.blackRating)}`;

/** Share a game's blog again (`share`), or stop sharing it; throws if that failed. */
async function setShared(gameId: string, share: boolean): Promise<void> {
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/share`, { method: share ? 'POST' : 'DELETE' });
  if (!res.ok) throw new Error(`${share ? 'share' : 'un-share'} failed (${res.status})`);
}

export function BlogDirectory({ entries, initialFilter = NO_FILTER, directoryKey, canUnshare = false }: {
  entries: DirectoryEntry[];
  /** The search and filter to start with; none unless asked for. */
  initialFilter?: DirectoryFilter;
  /** The key this directory was opened with: remembered for the visit, so a game can link back here. */
  directoryKey?: string;
  /** The signed-in author's own directory: each game has a "Stop sharing" button. Never for readers. */
  canUnshare?: boolean;
}) {
  const [filter, setFilter] = useState<DirectoryFilter>(initialFilter);
  // Games un-shared on this visit, which leave the list at once
  const [unshared, setUnshared] = useState<ReadonlySet<string>>(() => new Set());
  // The game un-shared last, for the note that offers to share it again
  const [undo, setUndo] = useState<{ entry: DirectoryEntry; busy: boolean; failed: boolean } | null>(null);
  const undoRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!directoryKey) return;
    try { sessionStorage.setItem(DIRECTORY_KEY_STORAGE, directoryKey); } catch { /* storage may be off */ }
  }, [directoryKey]);

  // The game's row has gone, and focus with it: put it on the note that says what happened
  const undoGameId = undo?.entry.gameId;
  useEffect(() => {
    if (undoGameId) undoRef.current?.focus();
  }, [undoGameId]);

  const listed = useMemo(() => entries.filter(e => !unshared.has(e.gameId)), [entries, unshared]);
  const tally = useMemo(() => tallyResults(listed), [listed]);
  const shown = useMemo(() => filterDirectory(listed, filter), [listed, filter]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const filtering = filter.query.trim() !== '' || filter.result !== 'all';

  const unshare = async (entry: DirectoryEntry) => {
    await setShared(entry.gameId, false);
    setUnshared(s => new Set(s).add(entry.gameId));
    setUndo({ entry, busy: false, failed: false });
  };

  const shareAgain = async () => {
    if (!undo) return;
    const { entry } = undo;
    setUndo({ entry, busy: true, failed: false });
    try {
      await setShared(entry.gameId, true);
      setUnshared(s => {
        const next = new Set(s);
        next.delete(entry.gameId);
        return next;
      });
      setUndo(null);
    } catch {
      setUndo({ entry, busy: false, failed: true });
    }
  };

  const undoNote = undo && (
    <p
      ref={undoRef}
      tabIndex={-1}
      role="status"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-3 text-base text-gray-700 dark:text-gray-300 focus:outline-none"
    >
      Stopped sharing <strong className="font-semibold">{gameTitle(undo.entry)}</strong>: it is off this list,
      and its link no longer opens for readers.{' '}
      <button
        type="button"
        onClick={shareAgain}
        disabled={undo.busy}
        className="font-medium text-purple-700 dark:text-purple-300 hover:underline disabled:opacity-60"
      >
        {undo.busy ? 'Sharing…' : 'Share it again'}
      </button>
      {undo.failed && (
        <span role="alert" className="text-red-700 dark:text-red-400"> Couldn&apos;t share it again — please try again.</span>
      )}
    </p>
  );

  if (listed.length === 0) {
    return (
      <div className="space-y-6">
        {undoNote}
        <p className="py-16 text-center text-base text-gray-600 dark:text-gray-400">
          No games have been shared yet.
        </p>
      </div>
    );
  }

  const counts: Record<DirectoryFilter['result'], number> = {
    all: tally.total, win: tally.win, draw: tally.draw, loss: tally.loss,
  };
  const tallyParts = [
    plural(tally.total, 'game', 'games'),
    tally.win > 0 && plural(tally.win, 'win', 'wins'),
    tally.draw > 0 && plural(tally.draw, 'draw', 'draws'),
    tally.loss > 0 && plural(tally.loss, 'loss', 'losses'),
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {undoNote}
      <p className="text-base text-gray-600 dark:text-gray-400">{tallyParts.join(' · ')}</p>

      <div role="search" className="flex flex-wrap items-center gap-3">
        <label htmlFor="directory-search" className="sr-only">Search by player or game number</label>
        <input
          id="directory-search"
          type="search"
          value={filter.query}
          onChange={e => setFilter(f => ({ ...f, query: e.target.value }))}
          placeholder="Search by opponent…"
          className="w-full sm:w-64 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div role="group" aria-label="Filter by result" className="flex flex-wrap gap-2">
          {RESULT_FILTERS.map(({ value, label }) => {
            const active = filter.result === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={counts[value] === 0}
                onClick={() => setFilter(f => ({ ...f, result: value }))}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-default ${
                  active
                    ? 'border-purple-600 bg-purple-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {label} <span className="tabular-nums opacity-80">{counts[value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">
        {filtering ? `Showing ${shown.length} of ${tally.total}` : ''}
      </p>

      {shown.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-base text-gray-700 dark:text-gray-300">No games match.</p>
          <button
            type="button"
            onClick={() => setFilter(NO_FILTER)}
            className="text-sm font-medium text-purple-700 dark:text-purple-300 hover:underline"
          >
            Clear the search and filter
          </button>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.key} aria-labelledby={`month-${group.key}`} className="space-y-3">
            <h2 id={`month-${group.key}`} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {group.label}
            </h2>
            <ul className="space-y-3">
              {group.entries.map(entry => (
                <GameRow key={entry.gameId} entry={entry} onUnshare={canUnshare ? unshare : undefined} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

// The whole card opens the blog. A link can't hold other links, so the card is a
// positioned <li>, the blog link is its title with an overlay (::after) covering
// the card, and the profile links and the author's controls sit above that
// overlay (relative z-10).
function GameRow({ entry, onUnshare }: {
  entry: DirectoryEntry;
  /** The author's own directory: stop sharing this game (throws if that failed). */
  onUnshare?: (entry: DirectoryEntry) => Promise<void>;
}) {
  const when = [formatDateRange(entry.startDate, entry.endDate), entry.timeControl].filter(Boolean).join(' · ');
  // Stopping takes a second click, in the row itself, so a stray click can't do it
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelId = `unshare-${entry.gameId}`;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    setFailed(false);
    askRef.current?.focus();
  };

  const stop = async () => {
    if (!onUnshare) return;
    setBusy(true);
    setFailed(false);
    try {
      await onUnshare(entry); // the row leaves the list
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <li className="relative rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 transition-colors hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50/40 dark:hover:bg-purple-900/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple-500">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={blogPath(entry.token)}
          className="text-lg font-semibold text-gray-900 dark:text-gray-100 after:absolute after:inset-0 after:content-[''] focus:outline-none"
        >
          {gameTitle(entry)}
        </Link>
        {entry.inProgress ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
            In progress
          </span>
        ) : <ResultBadge result={entry.result} />}
        {onUnshare && (
          <button
            ref={askRef}
            type="button"
            onClick={() => (confirming ? cancel() : setConfirming(true))}
            aria-expanded={confirming}
            aria-controls={panelId}
            className="relative z-10 ml-auto rounded-md px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-red-700 dark:hover:text-red-400"
          >
            Stop sharing
          </button>
        )}
      </div>
      {when && <p className="mt-1 text-base text-gray-600 dark:text-gray-400">{when}</p>}
      <p className="mt-1 text-base text-gray-700 dark:text-gray-300">{describeCommentary(entry)}</p>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Chess.com profiles:{' '}
        <span className="relative z-10"><PlayerLink name={entry.white} /></span>
        {' · '}
        <span className="relative z-10"><PlayerLink name={entry.black} /></span>
      </p>
      {onUnshare && confirming && (
        <div
          id={panelId}
          role="group"
          aria-label={`Stop sharing ${gameTitle(entry)}?`}
          className="relative z-10 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-gray-800 dark:text-gray-200"
        >
          <span>Stop sharing this game? It leaves this list, and its link stops opening for readers.</span>
          <button
            ref={confirmRef}
            type="button"
            onClick={stop}
            disabled={busy}
            className="rounded-md bg-red-700 px-3 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            {busy ? 'Stopping…' : 'Stop sharing'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-md px-3 py-1 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            Cancel
          </button>
          {failed && (
            <span role="alert" className="text-red-700 dark:text-red-400">Couldn&apos;t stop sharing — please try again.</span>
          )}
        </div>
      )}
    </li>
  );
}
