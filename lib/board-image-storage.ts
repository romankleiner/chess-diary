import { put, head, list, del } from '@vercel/blob';

/**
 * Get a cached board image from Vercel Blob storage (PUBLIC store)
 * If the image doesn't exist, fetch it from chess-api.com and cache it
 */
export async function getCachedBoardImage(
  fen: string, 
  pov: 'white' | 'black' = 'white'
): Promise<string> {
  // Strip move numbers from FEN if present (some APIs don't accept them)
  // FEN format: position active castling en-passant halfmove fullmove
  // We only need: position active castling en-passant
  const fenParts = fen.trim().split(/\s+/);
  const fenForRendering = fenParts.slice(0, 4).join(' '); // Keep only first 4 parts
  
  // Create cache key based on FEN and perspective
  const cacheKey = `boards/${Buffer.from(fenForRendering).toString('base64').replace(/\//g, '_')}-${pov}.png`;
  
  try {
    // Check if image exists in PUBLIC blob storage
    const exists = await head(cacheKey, {
      token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
    });
    if (exists) {
      console.log('[BOARD-CACHE] Cache hit:', cacheKey);
      return exists.url; // Return CDN URL
    }
  } catch (error) {
    // Image doesn't exist, need to generate
    console.log('[BOARD-CACHE] Cache miss:', cacheKey);
  }
  
  // Generate image from chessvision.ai
  const fenActiveSide = fenParts[1] === 'b' ? 'black' : 'white';
  const apiUrl = `https://fen2image.chessvision.ai/${fenParts[0]}?turn=${fenActiveSide}&pov=${pov}`;
  
  console.log('[BOARD-CACHE] Fetching from chessvision.ai:', apiUrl);
  
  const response = await fetch(apiUrl, { redirect: 'follow' });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch board image from chessvision.ai: ${response.status} ${response.statusText}`);
  }
  
  const imageBuffer = await response.arrayBuffer();
  
  // Upload to blob storage with public access
  console.log('[BOARD-CACHE] Uploading to blob storage...');
  const blob = await put(cacheKey, imageBuffer, {
    access: 'public',
    contentType: 'image/png',
    token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
  });
  
  console.log('[BOARD-CACHE] Cached:', blob.url);
  return blob.url;
}

/**
 * Get image URL for a journal entry image
 * If it's a base64 image, migrate it to PUBLIC blob storage
 * If it's already a URL, return it as-is
 */
export async function getImageUrl(
  entryId: number,
  image: string,
  imageIndex: number
): Promise<string> {
  // Check if already migrated (URL format)
  if (image.startsWith('http')) {
    return image; // Already a blob URL
  }
  
  // Still base64, migrate now
  const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image format');
  }
  
  const imageType = matches[1];
  const base64Data = matches[2];
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  // Upload to PUBLIC blob storage
  const blobKey = `journal/${entryId}/${imageIndex}.${imageType}`;
  
  console.log(`[IMAGE-MIGRATE] Migrating image: ${blobKey}`);
  
  const blob = await put(blobKey, imageBuffer, {
    access: 'public',
    contentType: `image/${imageType}`,
    token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
  });
  
  console.log(`[IMAGE-MIGRATE] Migrated: ${blob.url}`);

  return blob.url;
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