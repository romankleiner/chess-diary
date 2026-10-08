/**
 * What goes into the blog's copy of a journal entry. Pure.
 *
 * The journal keeps pasted screenshots inline, as data URLs, and they are 98% of
 * its bytes (81 of 82.6 MB on the author's journal). The blog never shows them,
 * yet it used to read the whole journal -- images and all, every game -- on every
 * page view. So each entry that belongs to a game is also kept, without its
 * images, filed under that game (see the journal section of lib/db.ts), and the
 * blog reads just the one game's copies: about 18 KB rather than 82 MB.
 */

/** The fields that hold pasted images. */
export const IMAGE_FIELDS = ['image', 'images'] as const;

/** The entry as the blog needs it: everything but its images. */
export function withoutImages<T extends object>(entry: T): Omit<T, (typeof IMAGE_FIELDS)[number]> {
  const copy = { ...entry } as Record<string, unknown>;
  for (const field of IMAGE_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof IMAGE_FIELDS)[number]>;
}

/** The game an entry's copy is filed under, as text; '' for an entry that belongs to no game. */
export function entryGameId(entry: { gameId?: unknown }): string {
  const { gameId } = entry;
  return gameId === null || gameId === undefined ? '' : String(gameId).trim();
}
