import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { BlogDirectory } from '@/components/BlogDirectory';
import { DirectoryShareLink } from '@/components/DirectoryShareLink';
import { loadBlogDirectory } from '@/lib/blog-directory-server';
import { recordVisit } from '@/lib/blog-visits-server';
import { sortDirectory } from '@/lib/blog-directory';
import type { DirectoryEntry } from '@/lib/blog-directory';
import { DIRECTORY_KEY_PARAM, isDirectoryKey } from '@/lib/directory-key';
import type { Viewer } from '@/lib/access-log';
import { getDirectoryOwner, getOrCreateDirectoryKey } from '@/lib/db';

// The directory of an author's shared games, unlisted: it opens with the author's
// secret key (/blog?key=...), or for the author when signed in, and is a plain 404
// for anyone else -- so it can't be found by scanning the site. Read per visit (a
// short in-memory cache keeps that cheap), not at build time, so it needs no
// database to build and a game shared a minute ago is already in it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Game blogs — Chess Diary',
  description: 'Games played through move by move, with the thinking behind the key moves. Try to guess the move.',
};

interface Access {
  /** Whose directory this is. */
  ownerId: string;
  /** The key that opens it, for the reader's browser to remember (and for the author to share). */
  key: string;
  viewer: Viewer;
}

/** Whose directory this request may see, or null if none. */
async function resolveAccess(keyParam: unknown): Promise<Access | null> {
  const { userId } = await auth();
  if (isDirectoryKey(keyParam)) {
    const ownerId = await getDirectoryOwner(keyParam);
    return ownerId ? { ownerId, key: keyParam, viewer: userId === ownerId ? 'owner' : 'visitor' } : null;
  }
  // No key at all: the author's own directory, if they are signed in
  if (keyParam === undefined && userId) {
    return { ownerId: userId, key: await getOrCreateDirectoryKey(userId), viewer: 'owner' };
  }
  return null;
}

export default async function BlogDirectoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const keyParam = (await searchParams)[DIRECTORY_KEY_PARAM];

  let access: Access | null = null;
  let failed = false;
  try {
    access = await resolveAccess(keyParam);
  } catch (error) {
    console.error('[BLOG-DIRECTORY] Error:', error);
    failed = true;
  }
  if (!access && !failed) notFound();

  let entries: DirectoryEntry[] | null = null;
  if (access) {
    await recordVisit(access.ownerId, await headers(), { page: 'directory', viewer: access.viewer });
    try {
      entries = sortDirectory(await loadBlogDirectory(access.ownerId));
    } catch (error) {
      console.error('[BLOG-DIRECTORY] Error:', error);
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Game blogs</h1>
        <p className="max-w-3xl text-base text-gray-600 dark:text-gray-300 leading-relaxed">
          Each game is played through move by move. Wherever I paused to write down what I was
          thinking, you can try to guess my move. Pick a game to start.
        </p>
      </header>

      {access?.viewer === 'owner' && <DirectoryShareLink directoryKey={access.key} />}

      {access && entries ? (
        <BlogDirectory entries={entries} directoryKey={access.key} />
      ) : (
        <p role="alert" className="py-16 text-center text-base text-red-700 dark:text-red-400">
          The list of games couldn&apos;t be loaded right now. Please try again in a moment.
        </p>
      )}
    </div>
  );
}
