'use client';

/**
 * For the author only, on their own directory: the secret link to share, a copy
 * button, and a way to replace the link (the old one stops working at once).
 */

import { useState, useSyncExternalStore } from 'react';
import { DIRECTORY_KEY_STORAGE, directoryPath } from '@/lib/directory-key';

const noSubscription = () => () => {};
/** The site's own address; empty while rendering on the server. */
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => '');

export function DirectoryShareLink({ directoryKey }: { directoryKey: string }) {
  const origin = useOrigin();
  const [key, setKey] = useState(directoryKey);
  const [status, setStatus] = useState<'idle' | 'copied' | 'replacing' | 'replaced' | 'error'>('idle');
  const link = `${origin}${directoryPath(key)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };

  const replace = async () => {
    if (!window.confirm('Make a new link? The current one will stop working for everyone you have given it to.')) return;
    setStatus('replacing');
    try {
      const res = await fetch('/api/blog-directory/key', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.key !== 'string') throw new Error();
      setKey(body.key);
      try { sessionStorage.setItem(DIRECTORY_KEY_STORAGE, body.key); } catch { /* storage may be off */ }
      setStatus('replaced');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section
      aria-labelledby="share-directory"
      className="rounded-lg border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 p-4 space-y-3"
    >
      <div className="space-y-1">
        <h2 id="share-directory" className="text-base font-semibold text-purple-900 dark:text-purple-200">
          Your secret link to this page
        </h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Only you see this box. Anyone with the link can browse your shared games; without it,
          this page doesn&apos;t exist. Search engines are asked not to index it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-directory-link
          className="min-w-0 max-w-full flex-1 truncate rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
        >
          {link}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          {status === 'copied' ? '✓ Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={replace}
          disabled={status === 'replacing'}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {status === 'replacing' ? 'Making a new link…' : 'Make a new link'}
        </button>
      </div>
      <p aria-live="polite" className="text-sm text-gray-700 dark:text-gray-300 empty:hidden">
        {status === 'replaced' ? 'New link made. The old one no longer works.'
          : status === 'error' ? 'That didn’t work — please try again.'
          : ''}
      </p>
    </section>
  );
}
