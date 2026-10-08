/**
 * The secret link to the public directory of shared games (/blog?key=...).
 * Pure and browser-safe; storing and checking keys is in lib/db.ts.
 *
 * The directory is not secret in the sense of being protected: anyone with the
 * link can open it and pass it on. It is unlisted -- without the key /blog is a
 * plain 404, so it can't be found by guessing the address or by scanning the site,
 * and it can be revoked by making a new link.
 */

/** The query parameter the key travels in. */
export const DIRECTORY_KEY_PARAM = 'key';

/**
 * Where a reader's browser remembers the key for the rest of the visit, so a game
 * opened from the directory can link back to it. Only readers who came through
 * the directory have it: a game link shared on its own doesn't lead to the rest.
 */
export const DIRECTORY_KEY_STORAGE = 'chess-diary:directory-key';

/** A key is 22 characters of base64url: 128 random bits. */
export function isDirectoryKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

/**
 * The key a reader's browser remembered for this visit, if what it holds is one.
 * Storage is handed over as a getter: just touching it can throw where the
 * browser has it switched off, and that must read as "no key", not break the page.
 */
export function storedDirectoryKey(getStorage: () => Pick<Storage, 'getItem'>): string | null {
  try {
    const key = getStorage().getItem(DIRECTORY_KEY_STORAGE);
    return isDirectoryKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** The directory's address for a key, relative to the site. */
export function directoryPath(key: string): string {
  return `/blog?${DIRECTORY_KEY_PARAM}=${encodeURIComponent(key)}`;
}
