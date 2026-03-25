import Redis from 'ioredis';
import { auth } from '@clerk/nextjs/server';

export interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
  game_analyses?: Record<string, any>;
}

// Create Redis client
let redis: Redis | null = null;

function getRedisClient(): Redis {
  if (!redis && process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL);
  }
  
  if (!redis) {
    throw new Error('Redis not configured');
  }
  
  return redis;
}

// Get user ID from Clerk
async function getUserId(): Promise<string> {
  const authResult = await auth();
  const userId = authResult.userId;
  
  if (!userId) {
    throw new Error('User not authenticated');
  }
  
  return userId;
}

// Initialize empty database structure
function getEmptyDb(): DatabaseData {
  return {
    games: {},
    journal_entries: [],
    move_analysis: [],
    settings: {}
  };
}

// Get database for current user - now reads from split keys
export async function getDb(userId?: string): Promise<DatabaseData> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  
  try {
    // Read each section separately
    const [gamesData, journalData, analysesData, settingsData, analysisProgressData] = await Promise.all([
      client.get(`chess-diary:${uid}:games`),
      client.get(`chess-diary:${uid}:journal`),
      client.get(`chess-diary:${uid}:analyses`),
      client.get(`chess-diary:${uid}:settings`),
      client.get(`chess-diary:${uid}:progress`),
    ]);
    
    const db: any = {
      games: gamesData ? JSON.parse(gamesData) : {},
      journal_entries: journalData ? JSON.parse(journalData) : [],
      move_analysis: [],
      settings: settingsData ? JSON.parse(settingsData) : {},
      game_analyses: analysesData ? JSON.parse(analysesData) : {},
      analysis_progress: analysisProgressData ? JSON.parse(analysisProgressData) : {},
    };
    
    return db;
  } catch (error) {
    console.error('[REDIS] Error reading from split keys:', error);
    
    // Fallback: try reading from old monolithic key
    try {
      const oldData = await client.get(`chess-diary:${uid}`);
      if (oldData) {
        console.log('[REDIS] Found old monolithic data, using it');
        return JSON.parse(oldData) as DatabaseData;
      }
    } catch (fallbackError) {
      console.error('[REDIS] Fallback also failed:', fallbackError);
    }
    
    return getEmptyDb();
  }
}

// --- Partial-read helpers (single key each) ---

export async function getGames(userId?: string): Promise<Record<string, any>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.get(`chess-diary:${uid}:games`);
  return data ? JSON.parse(data) : {};
}

export async function getJournal(userId?: string): Promise<any[]> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.get(`chess-diary:${uid}:journal`);
  return data ? JSON.parse(data) : [];
}

export async function getAnalyses(userId?: string): Promise<Record<string, any>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.get(`chess-diary:${uid}:analyses`);
  return data ? JSON.parse(data) : {};
}

export async function getSettings(userId?: string): Promise<Record<string, string>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.get(`chess-diary:${uid}:settings`);
  return data ? JSON.parse(data) : {};
}

// --- Per-game progress helpers (TTL-based, no read-modify-write) ---

const PROGRESS_TTL = 600; // 10 minutes

export async function setGameProgress(gameId: string, current: number, total: number, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:progress:${gameId}`;
  await client.setex(key, PROGRESS_TTL, JSON.stringify({ current, total }));
}

export async function getGameProgress(gameId: string, userId?: string): Promise<{ current: number; total: number } | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:progress:${gameId}`;
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

export async function clearGameProgress(gameId: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.del(`chess-diary:${uid}:progress:${gameId}`);
}

// Legacy bulk progress helpers (kept for getDb/saveDb compatibility)
export async function getProgress(userId?: string): Promise<Record<string, any>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.get(`chess-diary:${uid}:progress`);
  return data ? JSON.parse(data) : {};
}

// Save database - now writes to split keys
export async function saveDb(data: DatabaseData, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  
  try {
    // Write each section separately (in parallel for speed)
    await Promise.all([
      client.set(`chess-diary:${uid}:games`, JSON.stringify(data.games)),
      client.set(`chess-diary:${uid}:journal`, JSON.stringify(data.journal_entries)),
      client.set(`chess-diary:${uid}:analyses`, JSON.stringify(data.game_analyses || {})),
      client.set(`chess-diary:${uid}:settings`, JSON.stringify(data.settings)),
      client.set(`chess-diary:${uid}:progress`, JSON.stringify((data as any).analysis_progress || {})),
    ]);
    
    console.log('[REDIS] Saved to split keys');
  } catch (error) {
    console.error('[REDIS] Error saving to Redis:', error);
    throw new Error(`Failed to save database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Helper: Save only journal entries (for journal operations)
export async function saveJournal(entries: any[], userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:journal`, JSON.stringify(entries));
}

// Helper: Save only games (for game operations)
export async function saveGames(games: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:games`, JSON.stringify(games));
}

// Helper: Save only analyses (for analysis operations)
export async function saveAnalyses(analyses: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:analyses`, JSON.stringify(analyses));
}

// Helper: Save only settings (for settings operations)
export async function saveSettings(settings: Record<string, string>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:settings`, JSON.stringify(settings));
}

// Legacy: Save bulk progress key (kept for saveDb compatibility)
export async function saveProgress(progress: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:progress`, JSON.stringify(progress));
}

export default getDb;