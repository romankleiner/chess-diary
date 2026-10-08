'use client';

/**
 * The author's view of who read their blog: totals for the last day, week and
 * month, then every recorded view, newest first. The data and its wording come
 * from lib/access-log.ts.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { agentLabel, describeAgent, locationLabel, referrerLabel, summarizeVisits } from '@/lib/access-log';
import type { BlogVisit } from '@/lib/access-log';

const PERIODS: Array<{ label: string; days: number }> = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BlogVisits({ visits, gameNames, recording, kept, ownOrigin = null, now = new Date() }: {
  visits: BlogVisit[];
  /** "white vs black" by game id. */
  gameNames: Record<string, string>;
  /** Whether this deployment records visits at all (only the live site does). */
  recording: boolean;
  /** How many views the log keeps. */
  kept: number;
  /** This site's origin, so links from its own pages read as such. */
  ownOrigin?: string | null;
  now?: Date;
}) {
  const [includeOwn, setIncludeOwn] = useState(false);
  const shown = useMemo(() => visits.filter(v => includeOwn || v.viewer === 'visitor'), [visits, includeOwn]);

  return (
    <div className="space-y-6">
      {!recording && (
        <p className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200">
          Visits are recorded on the live site only, so viewing the blog here adds nothing to this list.
        </p>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PERIODS.map(({ label, days }) => {
          const s = summarizeVisits(visits, { now, days });
          return (
            <div key={days} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
              <dt className="text-sm text-gray-600 dark:text-gray-400">{label}</dt>
              <dd className="mt-1 text-base text-gray-900 dark:text-gray-100">
                <span className="text-2xl font-semibold tabular-nums">{s.views}</span> {s.views === 1 ? 'view' : 'views'}
                <span className="block text-sm text-gray-600 dark:text-gray-400">
                  {plural(s.addresses, 'address', 'addresses')}{s.bots > 0 ? ` · ${plural(s.bots, 'by a bot', 'by bots')}` : ''}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={includeOwn} onChange={e => setIncludeOwn(e.target.checked)} className="h-4 w-4" />
          Include my own visits
        </label>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          The last {kept.toLocaleString('en')} views are kept. Totals leave out your own.
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="py-12 text-center text-base text-gray-600 dark:text-gray-400">No visits recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <tr>
                {['When', 'Page', 'Where', 'Address', 'Browser', 'Came from'].map(h => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-800 dark:text-gray-200">
              {shown.map((v, i) => (
                <tr key={`${v.at}-${i}`} data-viewer={v.viewer}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <time dateTime={v.at}>{new Date(v.at).toLocaleString()}</time>
                    {v.viewer === 'owner' && (
                      <span className="ml-2 rounded bg-purple-100 dark:bg-purple-900/50 px-1.5 py-0.5 text-xs text-purple-800 dark:text-purple-200">You</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {v.page === 'directory' ? 'Directory'
                      : v.gameId ? <Link href={`/blog/${v.gameId}`} className="text-purple-700 dark:text-purple-300 hover:underline">{gameNames[v.gameId] ?? `Game ${v.gameId}`}</Link>
                      : 'A game'}
                  </td>
                  <td className="px-3 py-2">{locationLabel(v)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{v.ip ?? 'Unknown'}</td>
                  <td className="px-3 py-2">
                    <span title={v.userAgent ?? undefined}>{agentLabel(v.userAgent)}</span>
                    {describeAgent(v.userAgent).bot && (
                      <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">bot</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{referrerLabel(v.referrer, ownOrigin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
