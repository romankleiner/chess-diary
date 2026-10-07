/**
 * Reading the public directory out of the database: every game its author has
 * shared, with what the directory shows of each. Server only. (What a row is,
 * and how rows are ordered and filtered, is in lib/blog-directory.ts.)
 *
 * Nothing is listed that was not shared: the index it starts from is the one
 * "Share link" writes to, and a game not in it cannot be opened by anyone else.
 */
import { getGamesById, getJournal, getSetting, listPublishedBlogs } from '@/lib/db';
import { buildDirectoryEntry, countCommentary } from '@/lib/blog-directory';
import type { DirectoryEntry } from '@/lib/blog-directory';

/**
 * Counting what each game has written about it means reading the author's whole
 * journal (the entries carry their pasted images), so a visit within this long
 * of the last one is answered from memory. It is per server instance, so a game
 * shared or un-shared on another instance can take this long to show up there.
 */
export const DIRECTORY_CACHE_MS = 60_000;

let cached: { at: number; entries: DirectoryEntry[] } | null = null;

/** Forget the remembered directory, so the next visit reads it afresh. */
export function clearBlogDirectoryCache(): void {
  cached = null;
}

async function readDirectory(): Promise<DirectoryEntry[]> {
  const published = await listPublishedBlogs();

  const byOwner = new Map<string, string[]>();
  for (const { gameId, ownerId } of published) {
    byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), gameId]);
  }

  const perOwner = await Promise.all([...byOwner].map(async ([ownerId, gameIds]) => {
    const [games, journal, username] = await Promise.all([
      getGamesById(gameIds, ownerId),
      getJournal(ownerId),
      getSetting('chesscom_username', ownerId),
    ]);
    const commentary = countCommentary(journal, new Set(gameIds));

    // A published game whose record has gone is skipped rather than listed with nothing to open
    return gameIds.filter(id => games[id]).map(gameId => buildDirectoryEntry({
      gameId,
      game: games[gameId],
      username,
      commentedMoves: commentary.get(gameId)?.commentedMoves ?? 0,
      hasSummary: commentary.get(gameId)?.hasSummary ?? false,
    }));
  }));

  return perOwner.flat();
}

export async function loadBlogDirectory(now: number = Date.now()): Promise<DirectoryEntry[]> {
  if (cached && now - cached.at < DIRECTORY_CACHE_MS) return cached.entries;
  const entries = await readDirectory();
  cached = { at: now, entries };
  return entries;
}
