import { kv } from '@vercel/kv';
import { auth } from '@clerk/nextjs/server';

export interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
}

// Get database key for current user
async function getUserDbKey(): Promise<string> {
  const authResult = await auth();
  const userId = authResult.userId;
  
  if (!userId) {
    throw new Error('User not authenticated');
  }
  
  return `chess-diary:${userId}`;
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
  let dbKey: string;
  
  if (userId) {
    dbKey = `chess-diary:${userId}`;
  } else {
    dbKey = await getUserDbKey();
  }
  
  try {
    const data = await kv.get<DatabaseData>(dbKey);
    
    if (!data) {
      // Initialize new database for user
      const emptyDb = getEmptyDb();
      await kv.set(dbKey, emptyDb);
      return emptyDb;
    }
    
    return data;
  } catch (error) {
    console.error('Error reading from KV:', error);
    return getEmptyDb();
  }
}

// Save database for current user
export async function saveDb(data: DatabaseData, userId?: string): Promise<void> {
  let dbKey: string;
  
  if (userId) {
    dbKey = `chess-diary:${userId}`;
  } else {
    dbKey = await getUserDbKey();
  }
  
  try {
    await kv.set(dbKey, data);
  } catch (error) {
    console.error('Error saving to KV:', error);
    throw new Error('Failed to save database');
  }
}

export default getDb;