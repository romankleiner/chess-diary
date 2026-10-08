'use client';

import { useEffect, useState } from 'react';
import { BlogVisits } from '@/components/BlogVisits';
import { BLOG_VISITS_KEPT } from '@/lib/access-log';
import type { BlogVisit } from '@/lib/access-log';

// The author's log of who has read their blog. Behind sign-in, like every page
// that isn't in lib/public-routes.ts.

interface VisitData {
  visits: BlogVisit[];
  gameNames: Record<string, string>;
  recording: boolean;
}

export default function VisitorsPage() {
  const [data, setData] = useState<VisitData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/blog-visits')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Blog visitors</h1>
        <p className="max-w-3xl text-base text-gray-600 dark:text-gray-300 leading-relaxed">
          Who opened your directory and game blogs, newest first. An address and a location are only
          a hint at who it was: a whole office or mobile network can share one address, and the place
          is worked out from it.
        </p>
      </header>
      {error && <p role="alert" className="text-base text-red-700 dark:text-red-400">The visit log couldn&apos;t be loaded. Please try again.</p>}
      {!error && !data && <p className="text-base text-gray-600 dark:text-gray-400">Loading…</p>}
      {data && (
        <BlogVisits
          visits={data.visits}
          gameNames={data.gameNames}
          recording={data.recording}
          kept={BLOG_VISITS_KEPT}
          ownOrigin={typeof window === 'undefined' ? null : window.location.origin}
        />
      )}
    </div>
  );
}
