import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
import { auth } from '@clerk/nextjs/server';

// Only allow from local development
function isLocalEnvironment() {
  return process.env.NODE_ENV === 'development' || 
         process.env.VERCEL_ENV === undefined;
}

export async function POST(request: NextRequest) {
  // Security: Only allow in local development
  if (!isLocalEnvironment()) {
    return NextResponse.json(
      { error: 'Can only be run locally for safety' }, 
      { status: 403 }
    );
  }
  
  try {
    const { oldRedisUrl, newRedisUrl } = await request.json();
    
    if (!oldRedisUrl || !newRedisUrl) {
      return NextResponse.json(
        { error: 'Provide both oldRedisUrl and newRedisUrl in request body' },
        { status: 400 }
      );
    }
    
    const authResult = await auth();
    const userId = authResult.userId;
    
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    // Connect to both Redis instances
    const oldRedis = new Redis(oldRedisUrl);
    const newRedis = new Redis(newRedisUrl);
    
    const key = `chess-diary:${userId}`;
    
    // Read from old Redis
    console.log('[COPY] Reading from old Redis...');
    const oldData = await oldRedis.get(key);
    
    if (!oldData) {
      return NextResponse.json({ 
        error: 'No data found in old Redis',
        key 
      }, { status: 404 });
    }
    
    const data = JSON.parse(oldData);
    const dataSize = oldData.length;
    
    // Write to new Redis (split keys for efficiency)
    console.log('[COPY] Writing to new Redis as split keys...');
    await Promise.all([
      newRedis.set(`chess-diary:${userId}:games`, JSON.stringify(data.games || {})),
      newRedis.set(`chess-diary:${userId}:journal`, JSON.stringify(data.journal_entries || [])),
      newRedis.set(`chess-diary:${userId}:analyses`, JSON.stringify(data.game_analyses || {})),
      newRedis.set(`chess-diary:${userId}:settings`, JSON.stringify(data.settings || {})),
      newRedis.set(`chess-diary:${userId}:progress`, JSON.stringify(data.analysis_progress || {})),
    ]);
    
    // Also write monolithic key as backup
    await newRedis.set(key, oldData);
    
    // Clean up connections
    await oldRedis.quit();
    await newRedis.quit();
    
    return NextResponse.json({
      success: true,
      copied: {
        fromUrl: oldRedisUrl.replace(/:[^:]*@/, ':***@'), // Hide password
        toUrl: newRedisUrl.replace(/:[^:]*@/, ':***@'),
        key,
        dataSizeKB: (dataSize / 1024).toFixed(2),
        dataSizeMB: (dataSize / 1024 / 1024).toFixed(2),
        journalEntries: data.journal_entries?.length || 0,
        games: Object.keys(data.games || {}).length,
        analyses: Object.keys(data.game_analyses || {}).length,
      },
      nextSteps: [
        '1. Update REDIS_URL in Vercel to point to new Redis',
        '2. Replace lib/db-redis.ts with db-redis-split.ts',
        '3. Deploy to Vercel',
        '4. Test that everything works',
        '5. You can now delete the old Redis DB'
      ]
    });
  } catch (error) {
    console.error('Copy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Copy failed' },
      { status: 500 }
    );
  }
}
