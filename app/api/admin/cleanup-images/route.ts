import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

export async function POST(request: NextRequest) {
  // Security: Only allow in local development
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ 
      error: 'Cleanup must be run locally for safety' 
    }, { status: 403 });
  }
  
  try {
    console.log('[CLEANUP] Starting image cleanup...');
    
    // Connect to Redis
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL not configured');
    }
    
    const redis = new Redis(process.env.REDIS_URL);
    
    // Get all user journal keys
    const journalKeys = await redis.keys('chess-diary:*:journal');
    
    let totalUsers = 0;
    let totalEntries = 0;
    let entriesWithImages = 0;
    let imagesCleared = 0;
    
    for (const journalKey of journalKeys) {
      totalUsers++;
      console.log(`[CLEANUP] Processing ${journalKey}...`);
      
      const journalData = await redis.get(journalKey);
      if (!journalData) continue;
      
      const entries = JSON.parse(journalData);
      if (!Array.isArray(entries)) continue;
      
      totalEntries += entries.length;
      let modified = false;
      
      for (const entry of entries) {
        if (!entry.images || entry.images.length === 0) continue;
        
        entriesWithImages++;
        
        // Clear all images - they will regenerate from FEN when accessed
        const imageCount = entry.images.length;
        entry.images = [];
        imagesCleared += imageCount;
        modified = true;
        
        console.log(`[CLEANUP] Cleared ${imageCount} images from entry ${entry.id}`);
      }
      
      // Save updated journal back to Redis
      if (modified) {
        await redis.set(journalKey, JSON.stringify(entries));
        console.log(`[CLEANUP] Updated ${journalKey}`);
      }
    }
    
    // Close Redis connection
    await redis.quit();
    
    const summary = {
      success: true,
      stats: {
        totalUsers,
        totalEntries,
        entriesWithImages,
        imagesCleared,
      },
      message: `Cleared ${imagesCleared} images from ${entriesWithImages} entries. Images will regenerate from FEN when accessed.`
    };
    
    console.log('[CLEANUP] Complete!', summary);
    
    return NextResponse.json(summary);
    
  } catch (error) {
    console.error('[CLEANUP] Cleanup failed:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Cleanup failed',
        success: false 
      },
      { status: 500 }
    );
  }
}
