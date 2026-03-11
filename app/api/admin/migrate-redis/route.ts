import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
import { auth } from '@clerk/nextjs/server';

// Only allow migration from local development
function isLocalEnvironment() {
  return process.env.NODE_ENV === 'development' || 
         process.env.VERCEL_ENV === undefined;
}

export async function POST(request: NextRequest) {
  // Security: Only allow in local development
  if (!isLocalEnvironment()) {
    return NextResponse.json(
      { 
        error: 'Migration can only be run locally for safety',
        hint: 'Run this on localhost:3000, not on Vercel production'
      }, 
      { status: 403 }
    );
  }
  
  try {
    const authResult = await auth();
    const userId = authResult.userId;
    
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    if (!process.env.REDIS_URL) {
      return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
    }
    
    const redis = new Redis(process.env.REDIS_URL);
    const oldKey = `chess-diary:${userId}`;
    
    // Read old monolithic data
    const oldData = await redis.get(oldKey);
    
    if (!oldData) {
      return NextResponse.json({ 
        error: 'No data found to migrate',
        key: oldKey 
      }, { status: 404 });
    }
    
    const data = JSON.parse(oldData);
    
    // Calculate sizes
    const oldSize = oldData.length;
    const gamesSize = JSON.stringify(data.games || {}).length;
    const journalSize = JSON.stringify(data.journal_entries || []).length;
    const analysesSize = JSON.stringify(data.game_analyses || {}).length;
    const settingsSize = JSON.stringify(data.settings || {}).length;
    const progressSize = JSON.stringify(data.analysis_progress || {}).length;
    
    // Write to split keys
    await Promise.all([
      redis.set(`chess-diary:${userId}:games`, JSON.stringify(data.games || {})),
      redis.set(`chess-diary:${userId}:journal`, JSON.stringify(data.journal_entries || [])),
      redis.set(`chess-diary:${userId}:analyses`, JSON.stringify(data.game_analyses || {})),
      redis.set(`chess-diary:${userId}:settings`, JSON.stringify(data.settings || {})),
      redis.set(`chess-diary:${userId}:progress`, JSON.stringify(data.analysis_progress || {})),
    ]);
    
    // Keep old key for safety (you can delete it manually later)
    // await redis.del(oldKey);
    
    return NextResponse.json({
      success: true,
      migration: {
        oldKey,
        oldSizeBytes: oldSize,
        oldSizeKB: (oldSize / 1024).toFixed(2),
        oldSizeMB: (oldSize / 1024 / 1024).toFixed(2),
        newKeys: {
          games: { sizeKB: (gamesSize / 1024).toFixed(2) },
          journal: { sizeKB: (journalSize / 1024).toFixed(2) },
          analyses: { sizeKB: (analysesSize / 1024).toFixed(2) },
          settings: { sizeKB: (settingsSize / 1024).toFixed(2) },
          progress: { sizeKB: (progressSize / 1024).toFixed(2) },
        },
        estimatedSavings: {
          description: 'Each operation now only reads/writes what it needs',
          examples: {
            'Add journal entry (before)': `${(oldSize * 2 / 1024).toFixed(0)}KB (read + write entire DB)`,
            'Add journal entry (after)': `${(journalSize * 2 / 1024).toFixed(0)}KB (read + write journal only)`,
            'Update progress (before)': `${(oldSize * 2 / 1024).toFixed(0)}KB`,
            'Update progress (after)': `${(progressSize * 2 / 1024).toFixed(0)}KB`,
          }
        }
      },
      message: 'Migration complete! Old key preserved for safety. Now replace lib/db-redis.ts with db-redis-split.ts and redeploy.',
      nextSteps: [
        '1. Replace lib/db-redis.ts with the new db-redis-split.ts',
        '2. Commit and push to GitHub',
        '3. Wait for Vercel to redeploy',
        '4. Test that everything still works',
        '5. Monitor Redis bandwidth usage - should drop 80-90%'
      ]
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}