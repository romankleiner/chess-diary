// Auto-detect and use Redis if REDIS_URL is available, otherwise use filesystem
import { DatabaseData as RedisDbData } from './db-redis';

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
  
  dbModule = await import('./db-redis'); 
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

export async function saveJournal(entries: any[], userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveJournal(entries, userId);
}

export async function saveGames(games: Record<string, any>, userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveGames(games, userId);
}

export async function saveAnalyses(analyses: Record<string, any>, userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveAnalyses(analyses, userId);
}

export async function saveSettings(settings: Record<string, string>, userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveSettings(settings, userId);
}

export async function saveProgress(progress: Record<string, any>, userId?: string): Promise<void> {
  const module = await getDbModule();
  return module.saveProgress(progress, userId);
}

export default getDb;