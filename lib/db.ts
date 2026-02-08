// Auto-detect and use Redis if REDIS_URL is available, otherwise use filesystem
import { DatabaseData as RedisDbData } from './db-redis';
import { DatabaseData as FsDbData } from './db-filesystem';

// Re-export the interface
export interface DatabaseData {
  games: Record<string, any>;
  journal_entries: any[];
  move_analysis: any[];
  settings: Record<string, string>;
  game_analyses?: Record<string, any>;
}

// Dynamically import the appropriate implementation
let dbModule: any = null;

async function getDbModule() {
  if (dbModule) return dbModule;
  
  if (process.env.REDIS_URL) {
    // Use Redis in production (Vercel)
    dbModule = await import('./db-redis');
  } else {
    // Use filesystem locally
    dbModule = await import('./db-filesystem');
  }
  
  return dbModule;
}

export async function getDb(userId?: string): Promise<DatabaseData> {
  const module = await getDbModule();
  return module.default(userId);
}

export async function saveDb(data: DatabaseData, userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveDb(data, userId);
}

export default getDb;