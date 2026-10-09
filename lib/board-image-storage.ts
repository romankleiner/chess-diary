import { put, head, list, del } from '@vercel/blob';
import { boardCacheKey, chessvisionUrl, parseBoardImageRequest } from './board-image-request';
import type { BoardImageRequest } from './board-image-request';

/**
 * The stored image of this diagram, or null if there isn't one. A single
 * HEAD on the store: cheap, and the only thing an anonymous request can cost
 * (see app/api/board-image/route.ts).
 */
export async function findCachedBoardImage(request: Pick<BoardImageRequest, 'fen4' | 'pov'>): Promise<string | null> {
  try {
    const found = await head(boardCacheKey(request), { token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN });
    return found?.url ?? null;
  } catch {
    // head() throws for a blob that isn't there
    return null;
  }
}

/**
 * Make the diagram with the image service and store it publicly; returns its
 * address. This is what costs: a fetch from a third party and a write to the
 * store, so only trusted callers (the signed-in author, the export) reach it.
 */
export async function generateBoardImage(request: BoardImageRequest): Promise<string> {
  const response = await fetch(chessvisionUrl(request), { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch board image from chessvision.ai: ${response.status} ${response.statusText}`);
  }
  const image = await response.arrayBuffer();

  // allowOverwrite: two simultaneous misses for the same diagram both write the
  // same key. The key is deterministic (same position and side ⇒ same image), so
  // the second write is harmless; without the flag, put() throws.
  const blob = await put(boardCacheKey(request), image, {
    access: 'public',
    contentType: 'image/png',
    token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
    allowOverwrite: true,
  });
  return blob.url;
}

/**
 * The stored image of a position, made and stored first if need be. For trusted
 * server-side callers only (the Word export): it always may generate. Throws for
 * a position that isn't one.
 */
export async function getCachedBoardImage(fen: string, pov: 'white' | 'black' = 'white'): Promise<string> {
  const request = parseBoardImageRequest(fen, pov);
  if ('error' in request) throw new Error(request.error);
  return (await findCachedBoardImage(request)) ?? generateBoardImage(request);
}

/**
 * Delete cached board images older than maxAgeDays.
 * Called from the automated backup route so it runs on the same schedule.
 * Returns the number of blobs deleted.
 */
export async function cleanupOldBoardImages(maxAgeDays = 90): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  console.log(`[BOARD-CACHE] Cleaning up board images older than ${maxAgeDays} days...`);

  // list() is paginated — iterate until done
  let cursor: string | undefined;
  do {
    const { blobs, cursor: nextCursor, hasMore } = await list({
      prefix: 'boards/',
      token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
      cursor,
    });

    for (const blob of blobs) {
      if (new Date(blob.uploadedAt).getTime() < cutoff) {
        await del(blob.url, { token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN });
        console.log('[BOARD-CACHE] Deleted expired image:', blob.pathname);
        deletedCount++;
      }
    }

    cursor = hasMore ? nextCursor : undefined;
  } while (cursor);

  console.log(`[BOARD-CACHE] Cleanup complete — ${deletedCount} image(s) deleted`);
  return deletedCount;
}