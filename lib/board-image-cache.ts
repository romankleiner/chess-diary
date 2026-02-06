// Shared in-memory cache for board images
const imageCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedBoardImage(fen: string, pov: 'white' | 'black'): Promise<Buffer> {
  const cacheKey = `${fen}-${pov}`;
  
  // Check cache
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.buffer;
  }
  
  // Fetch from chessvision.ai
  const url = `https://fen2image.chessvision.ai/${encodeURIComponent(fen)}${pov === 'black' ? '?pov=black' : ''}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error('Failed to fetch board image');
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Store in cache
  imageCache.set(cacheKey, { buffer, timestamp: Date.now() });
  
  // Clean old cache entries
  if (imageCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of imageCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        imageCache.delete(key);
      }
    }
  }
  
  return buffer;
}
