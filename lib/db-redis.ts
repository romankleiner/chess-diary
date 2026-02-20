import Redis from 'ioredis';
import { auth } from '@clerk/nextjs/server';

export interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
  game_analyses?: Record<string, any>; // Analysis results for games
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

// Get database for current user
export async function getDb(userId?: string): Promise<DatabaseData> {
  const uid = userId || await getUserId();
  const key = `chess-diary:${uid}`;
  
  try {
    const client = getRedisClient();
    const data = await client.get(key);
    
    if (!data) {
      // Create initial empty database for user
      const emptyDb = getEmptyDb();
      await client.set(key, JSON.stringify(emptyDb));
      return emptyDb;
    }
    
    return JSON.parse(data) as DatabaseData;
  } catch (error) {
    console.error('Error reading from Redis:', error);
    return getEmptyDb();
  }
}

// Save database for current user
export async function saveDb(data: DatabaseData, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const key = `chess-diary:${uid}`;
  
  try {
    const client = getRedisClient();
    await client.set(key, JSON.stringify(data));
    
    // Verify write
    const verify = await client.get(key);
    if (!verify) {
      throw new Error('Data verification failed - Redis returned null after save');
    }
  } catch (error) {
    console.error('[REDIS] Error saving to Redis:', error);
    throw new Error(`Failed to save database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default getDb;
