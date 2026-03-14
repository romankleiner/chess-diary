import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import Redis from 'ioredis';

export async function POST(request: NextRequest) {
  // Security: Only allow in local development
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ 
      error: 'Migration must be run locally for safety' 
    }, { status: 403 });
  }
  
  try {
    console.log('[MIGRATE] Starting image migration...');
    
    // Connect to Redis
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL not configured');
    }
    
    const redis = new Redis(process.env.REDIS_URL);
    
    // Get all user journal keys
    const journalKeys = await redis.keys('chess-diary:*:journal');
    
    let totalUsers = 0;
    let totalEntries = 0;
    let totalImages = 0;
    let migratedImages = 0;
    let skippedImages = 0;
    let errorImages = 0;
    
    for (const journalKey of journalKeys) {
      totalUsers++;
      console.log(`[MIGRATE] Processing ${journalKey}...`);
      
      const journalData = await redis.get(journalKey);
      if (!journalData) continue;
      
      const entries = JSON.parse(journalData);
      if (!Array.isArray(entries)) continue;
      
      totalEntries += entries.length;
      let modified = false;
      
      for (const entry of entries) {
        if (!entry.images || entry.images.length === 0) continue;
        
        const migratedUrls: string[] = [];
        
        for (let i = 0; i < entry.images.length; i++) {
          const image = entry.images[i];
          totalImages++;
          
          // Check if this is a private blob URL that needs re-migration
          if (image.startsWith('http')) {
            // Check if it's from the private blob store
            if (image.includes('.blob.vercel-storage.com/journal/')) {
              // Re-migrate from private to public store
              try {
                console.log(`[MIGRATE] Re-migrating from private store: ${image}`);
                
                // Fetch the image from private store
                const response = await fetch(image);
                if (!response.ok) {
                  console.warn(`[MIGRATE] Failed to fetch from private store: ${response.statusText}`);
                  migratedUrls.push(image); // Keep original
                  errorImages++;
                  continue;
                }
                
                const imageBuffer = await response.arrayBuffer();
                const imageType = 'png'; // Assume PNG for blob images
                
                // Upload to PUBLIC blob storage
                const blobKey = `journal/${entry.id}/${i}.${imageType}`;
                const blob = await put(blobKey, imageBuffer, {
                  access: 'public',
                  contentType: `image/${imageType}`,
                  token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
                });
                
                migratedUrls.push(blob.url);
                migratedImages++;
                console.log(`[MIGRATE] ✓ Re-migrated: ${blobKey} → ${blob.url}`);
                continue;
                
              } catch (error) {
                console.error(`[MIGRATE] Error re-migrating from private store:`, error);
                migratedUrls.push(image); // Keep original
                errorImages++;
                continue;
              }
            }
            
            // Already in public store or external URL
            migratedUrls.push(image);
            skippedImages++;
            continue;
          }
          
          try {
            // Extract base64 data
            const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!matches) {
              console.warn(`[MIGRATE] Invalid image format in entry ${entry.id}`);
              migratedUrls.push(image); // Keep original
              errorImages++;
              continue;
            }
            
            const imageType = matches[1];
            const base64Data = matches[2];
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Generate blob key
            const blobKey = `journal/${entry.id}/${i}.${imageType}`;
            
            // Upload to PUBLIC blob storage
            const blob = await put(blobKey, imageBuffer, {
              access: 'public',
              contentType: `image/${imageType}`,
              token: process.env.BLOB_IMAGES_READ_WRITE_TOKEN,
            });
            
            migratedUrls.push(blob.url);
            migratedImages++;
            
            console.log(`[MIGRATE] ✓ ${blobKey} → ${blob.url}`);
            
          } catch (error) {
            console.error(`[MIGRATE] Error migrating image ${i} in entry ${entry.id}:`, error);
            migratedUrls.push(image); // Keep original on error
            errorImages++;
          }
        }
        
        // Update entry if any images were migrated
        if (migratedUrls.length > 0) {
          entry.images = migratedUrls;
          modified = true;
        }
      }
      
      // Save updated journal back to Redis
      if (modified) {
        await redis.set(journalKey, JSON.stringify(entries));
        console.log(`[MIGRATE] Updated ${journalKey}`);
      }
    }
    
    // Close Redis connection
    await redis.quit();
    
    // Calculate savings
    const oldSizeKB = migratedImages * 75; // ~75KB average per base64 image
    const newSizeKB = migratedImages * 0.1; // ~100 bytes per URL
    const savedKB = oldSizeKB - newSizeKB;
    
    const summary = {
      success: true,
      stats: {
        totalUsers,
        totalEntries,
        totalImages,
        migratedImages,
        skippedImages, // Already migrated
        errorImages,
      },
      savings: {
        beforeKB: oldSizeKB.toFixed(0),
        afterKB: newSizeKB.toFixed(2),
        savedKB: savedKB.toFixed(0),
        savedMB: (savedKB / 1024).toFixed(2),
      },
      message: `Successfully migrated ${migratedImages} images to blob storage`
    };
    
    console.log('[MIGRATE] Complete!', summary);
    
    return NextResponse.json(summary);
    
  } catch (error) {
    console.error('[MIGRATE] Migration failed:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Migration failed',
        success: false 
      },
      { status: 500 }
    );
  }
}