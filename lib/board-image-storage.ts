import { put, head } from '@vercel/blob';

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
  
  // Generate image from chessboardimage.com
  const apiUrl = `https://chessboardimage.com/${fenForRendering}.png`;
  
  console.log('[BOARD-CACHE] Fetching from chessboardimage.com:', apiUrl);
  
  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch board image from chessboardimage.com: ${response.statusText}`);
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