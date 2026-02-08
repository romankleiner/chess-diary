import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { auth } from '@clerk/nextjs/server';

interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
  game_analyses?: Record<string, any>; // Analysis results for games
}

const dbCaches: Record<string, DatabaseData> = {};

function getDataPath(userId: string): string {
  const dataDir = path.join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, `chess-diary-${userId}.json`);
}

// Initialize or load database for specific user
export async function getDb(userId?: string): Promise<DatabaseData> {
  // Get user ID from Clerk if not provided
  if (!userId) {
    try {
      const authResult = await auth();
      const clerkUserId = authResult.userId;
      
      if (!clerkUserId) {
        // Return empty database structure if no user (shouldn't happen in protected routes)
        console.warn('getDb called without authenticated user');
        return {
          games: {},
          journal_entries: [],
          move_analysis: [],
          settings: {}
        };
      }
      userId = clerkUserId;
    } catch (error) {
      console.error('Error getting auth:', error);
      return {
        games: {},
        journal_entries: [],
        move_analysis: [],
        settings: {}
      };
    }
  }
  
  // Return cached data if available
  if (dbCaches[userId]) {
    return dbCaches[userId];
  }

  const dataPath = getDataPath(userId);
  
  if (existsSync(dataPath)) {
    try {
      const data = readFileSync(dataPath, 'utf-8');
      dbCaches[userId] = JSON.parse(data);
    } catch (error) {
      console.error('Error reading database file:', error);
      dbCaches[userId] = {
        games: {},
        journal_entries: [],
        move_analysis: [],
        settings: {}
      };
    }
  } else {
    dbCaches[userId] = {
      games: {},
      journal_entries: [],
      move_analysis: [],
      settings: {}
    };
    try {
      saveDb(dbCaches[userId], userId);
    } catch (error) {
      console.error('Error creating initial database:', error);
    }
  }
  
  return dbCaches[userId];
}

export async function saveDb(data: DatabaseData, userId?: string) {
  if (!userId) {
    try {
      const authResult = await auth();
      const clerkUserId = authResult.userId;
      
      if (!clerkUserId) {
        console.error('Cannot save database: user not authenticated');
        return;
      }
      userId = clerkUserId;
    } catch (error) {
      console.error('Error getting auth for save:', error);
      return;
    }
  }
  
  try {
    const dataPath = getDataPath(userId);
    writeFileSync(dataPath, JSON.stringify(data, null, 2));
    dbCaches[userId] = data;
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

export default getDb;