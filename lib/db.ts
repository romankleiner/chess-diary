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

// Helper: parse all fields of a Redis hash into an object of parsed values
function parseHashRecord(raw: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [field, value] of Object.entries(raw)) {
    result[field] = JSON.parse(value);
  }
  return result;
}

// Helper: parse all fields of a Redis hash into an array of parsed values
function parseHashArray(raw: Record<string, string>): any[] {
  return Object.values(raw).map(v => JSON.parse(v));
}

// ============================================================
// Games — Redis Hash: chess-diary:{uid}:games
//   field = gameId, value = JSON game object
// ============================================================

export async function getGame(gameId: string, userId?: string): Promise<any | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.hget(`chess-diary:${uid}:games`, gameId);
  return data ? JSON.parse(data) : null;
}

export async function saveGame(gameId: string, game: any, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hset(`chess-diary:${uid}:games`, gameId, JSON.stringify(game));
}

export async function deleteGame(gameId: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hdel(`chess-diary:${uid}:games`, gameId);
}

export async function getGames(userId?: string): Promise<Record<string, any>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const raw = await client.hgetall(`chess-diary:${uid}:games`);
  return parseHashRecord(raw);
}

export async function saveGames(games: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:games`;
  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const [id, game] of Object.entries(games)) {
    pipeline.hset(key, id, JSON.stringify(game));
  }
  await pipeline.exec();
}

// ============================================================
// Journal — Redis Hash: chess-diary:{uid}:journal
//   field = entryId (string), value = JSON entry object
// ============================================================

export async function getJournalEntry(entryId: number, userId?: string): Promise<any | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.hget(`chess-diary:${uid}:journal`, String(entryId));
  return data ? JSON.parse(data) : null;
}

export async function saveJournalEntry(entry: any, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hset(`chess-diary:${uid}:journal`, String(entry.id), JSON.stringify(entry));
}

export async function deleteJournalEntry(entryId: number, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hdel(`chess-diary:${uid}:journal`, String(entryId));
}

export async function getJournal(userId?: string): Promise<any[]> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const raw = await client.hgetall(`chess-diary:${uid}:journal`);
  return parseHashArray(raw);
}

export async function saveJournal(entries: any[], userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:journal`;
  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const entry of entries) {
    pipeline.hset(key, String(entry.id), JSON.stringify(entry));
  }
  await pipeline.exec();
}

// ============================================================
// Analyses — Redis Hash: chess-diary:{uid}:analyses
//   field = gameId, value = JSON analysis object
// ============================================================

export async function getAnalysis(gameId: string, userId?: string): Promise<any | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.hget(`chess-diary:${uid}:analyses`, gameId);
  return data ? JSON.parse(data) : null;
}

export async function saveAnalysis(gameId: string, analysis: any, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hset(`chess-diary:${uid}:analyses`, gameId, JSON.stringify(analysis));
}

export async function deleteAnalysis(gameId: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hdel(`chess-diary:${uid}:analyses`, gameId);
}

export async function getAnalyses(userId?: string): Promise<Record<string, any>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const raw = await client.hgetall(`chess-diary:${uid}:analyses`);
  return parseHashRecord(raw);
}

export async function saveAnalyses(analyses: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:analyses`;
  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const [id, analysis] of Object.entries(analyses)) {
    pipeline.hset(key, id, JSON.stringify(analysis));
  }
  await pipeline.exec();
}

// ============================================================
// Settings — Redis Hash: chess-diary:{uid}:settings
//   field = setting key, value = string value
// ============================================================

export async function getSetting(key: string, userId?: string): Promise<string | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  return client.hget(`chess-diary:${uid}:settings`, key);
}

export async function saveSetting(key: string, value: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hset(`chess-diary:${uid}:settings`, key, value);
}

export async function getSettings(userId?: string): Promise<Record<string, string>> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  return client.hgetall(`chess-diary:${uid}:settings`);
}

export async function saveSettings(settings: Record<string, string>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const key = `chess-diary:${uid}:settings`;
  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const [k, v] of Object.entries(settings)) {
    pipeline.hset(key, k, v);
  }
  await pipeline.exec();
}

// ============================================================
// Progress — per-game keys with TTL (unchanged from task 3)
// ============================================================

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

export async function saveProgress(progress: Record<string, any>, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.set(`chess-diary:${uid}:progress`, JSON.stringify(progress));
}

// ============================================================
// getDb / saveDb — legacy full-database operations
// Used by backup/restore and debug routes.
// ============================================================

function getEmptyDb(): DatabaseData {
  return {
    games: {},
    journal_entries: [],
    move_analysis: [],
    settings: {}
  };
}

export async function getDb(userId?: string): Promise<DatabaseData> {
  const uid = userId || await getUserId();

  try {
    const [games, journalEntries, analyses, settings] = await Promise.all([
      getGames(uid),
      getJournal(uid),
      getAnalyses(uid),
      getSettings(uid),
    ]);

    return {
      games,
      journal_entries: journalEntries,
      move_analysis: [],
      settings,
      game_analyses: analyses,
    };
  } catch (error) {
    console.error('[REDIS] Error reading database:', error);
    return getEmptyDb();
  }
}

export async function saveDb(data: DatabaseData, userId?: string): Promise<void> {
  const uid = userId || await getUserId();

  try {
    await Promise.all([
      saveGames(data.games, uid),
      saveJournal(data.journal_entries, uid),
      saveAnalyses(data.game_analyses || {}, uid),
      saveSettings(data.settings, uid),
    ]);
    console.log('[REDIS] Saved database');
  } catch (error) {
    console.error('[REDIS] Error saving database:', error);
    throw new Error(`Failed to save database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default getDb;
