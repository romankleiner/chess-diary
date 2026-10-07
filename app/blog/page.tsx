import type { Metadata } from 'next';
import { BlogDirectory } from '@/components/BlogDirectory';
import { loadBlogDirectory } from '@/lib/blog-directory-server';
import { sortDirectory } from '@/lib/blog-directory';
import type { DirectoryEntry } from '@/lib/blog-directory';

// The public directory of shared game blogs. No sign-in: it lists only games
// their author chose to share. Read per visit (a short in-memory cache keeps that
// cheap), not at build time, so it needs no database to build and a game shared
// a minute ago is already in it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Game blogs — Chess Diary',
  description: 'Games played through move by move, with the thinking behind the key moves. Try to guess the move.',
};

export default async function BlogDirectoryPage() {
  let entries: DirectoryEntry[] | null = null;
  try {
    entries = sortDirectory(await loadBlogDirectory());
  } catch (error) {
    console.error('[BLOG-DIRECTORY] Error:', error);
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

      {entries ? (
        <BlogDirectory entries={entries} />
      ) : (
        <p role="alert" className="py-16 text-center text-base text-red-700 dark:text-red-400">
          The list of games couldn&apos;t be loaded right now. Please try again in a moment.
        </p>
      )}
    </div>
  );
}
