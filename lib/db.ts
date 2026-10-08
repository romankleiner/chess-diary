import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { withCurrentAccuracy } from './analysis-utils';
import type { Game, JournalEntry } from '@/types';
import { BLOG_VISITS_KEPT } from './access-log';
import { entryGameId, withoutImages } from './journal-copies';

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
    redis = new Redis(process.env.REDIS_URL, {
      connectTimeout: 5000,       // 5 s to establish a TCP connection
      commandTimeout: 10000,      // 10 s per individual command; prevents indefinite hangs
      maxRetriesPerRequest: 2,    // fail fast instead of retrying 20 times (default)
    });
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

// Just the named games, not the whole hash (a game's PGN is long): the public
// directory reads a dozen of a few hundred. Games that are not there are left out.
export async function getGamesById(gameIds: string[], userId: string): Promise<Record<string, Game>> {
  if (gameIds.length === 0) return {};
  const client = getRedisClient();
  const values = await client.hmget(`chess-diary:${userId}:games`, ...gameIds);
  const games: Record<string, Game> = {};
  gameIds.forEach((id, i) => {
    if (values[i]) games[id] = JSON.parse(values[i] as string);
  });
  return games;
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
//
// The blog's copies, kept in step by every write below (in the same transaction):
//   chess-diary:{uid}:journal-by-game:{gameId}  hash: entryId → the entry without its images
//   chess-diary:{uid}:journal-games             hash: entryId → its gameId ('' for none), for
//                                               every entry: where its copy is filed
// The journal is 98% pasted images, which the blog never shows, so the public
// blog reads one game's copies instead of the whole journal (lib/journal-copies.ts).
// ============================================================

const journalKey = (uid: string) => `chess-diary:${uid}:journal`;
const gameJournalKey = (uid: string, gameId: string) => `chess-diary:${uid}:journal-by-game:${gameId}`;
const entryGamesKey = (uid: string) => `chess-diary:${uid}:journal-games`;
const copiesRebuiltKey = (uid: string) => `chess-diary:${uid}:journal-copies-rebuilt`;

/** The copies are rebuilt from the whole journal at most this often, whatever happens. */
export const JOURNAL_COPIES_REBUILD_SECONDS = 3600;

export async function getJournalEntry(entryId: number, userId?: string): Promise<any | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.hget(journalKey(uid), String(entryId));
  return data ? JSON.parse(data) : null;
}

export async function saveJournalEntry(entry: any, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const id = String(entry.id);
  const gameId = entryGameId(entry);
  // An entry moved to another game leaves its old copy behind unless removed
  const previous = await client.hget(entryGamesKey(uid), id);

  const tx = client.multi();
  tx.hset(journalKey(uid), id, JSON.stringify(entry));
  if (previous && previous !== gameId) tx.hdel(gameJournalKey(uid, previous), id);
  if (gameId) tx.hset(gameJournalKey(uid, gameId), id, JSON.stringify(withoutImages(entry)));
  tx.hset(entryGamesKey(uid), id, gameId);
  await tx.exec();
}

export async function deleteJournalEntry(entryId: number, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const id = String(entryId);
  const previous = await client.hget(entryGamesKey(uid), id);

  const tx = client.multi();
  tx.hdel(journalKey(uid), id);
  if (previous) tx.hdel(gameJournalKey(uid, previous), id);
  tx.hdel(entryGamesKey(uid), id);
  await tx.exec();
}

export async function getJournal(userId?: string): Promise<any[]> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const raw = await client.hgetall(journalKey(uid));
  return parseHashArray(raw);
}

/** Queue replacing every copy with copies of `entries`, given the games the old copies were filed under. */
function queueCopies(
  tx: ReturnType<Redis['multi']>,
  uid: string,
  entries: ReadonlyArray<{ id: unknown; gameId?: unknown }>,
  oldGameIds: Iterable<string>,
): void {
  tx.del(entryGamesKey(uid));
  for (const gameId of oldGameIds) tx.del(gameJournalKey(uid, gameId));
  for (const entry of entries) {
    const id = String(entry.id);
    const gameId = entryGameId(entry);
    tx.hset(entryGamesKey(uid), id, gameId);
    if (gameId) tx.hset(gameJournalKey(uid, gameId), id, JSON.stringify(withoutImages(entry)));
  }
}

const filedGames = async (client: Redis, uid: string) =>
  new Set((await client.hvals(entryGamesKey(uid))).filter(Boolean));

export async function saveJournal(entries: any[], userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const oldGameIds = await filedGames(client, uid);
  const tx = client.multi();
  tx.del(journalKey(uid));
  for (const entry of entries) {
    tx.hset(journalKey(uid), String(entry.id), JSON.stringify(entry));
  }
  queueCopies(tx, uid, entries, oldGameIds);
  await tx.exec();
}

/**
 * Make sure the copies are in step with the journal before they are read. They
 * are in step when every entry is filed (one count against another, two cheap
 * commands). If not -- the first time, before any copies existed, or after the
 * journal was changed some other way -- they are rebuilt from the whole journal,
 * but at most once an hour: nothing a reader does can make the blog read the
 * whole journal again and again. Readers in the meantime see the copies as they are.
 */
async function ensureJournalCopies(client: Redis, uid: string): Promise<void> {
  const [entries, filed] = await Promise.all([client.hlen(journalKey(uid)), client.hlen(entryGamesKey(uid))]);
  if (entries === filed) return;
  const claimed = await client.set(copiesRebuiltKey(uid), '1', 'EX', JOURNAL_COPIES_REBUILD_SECONDS, 'NX');
  if (!claimed) return;
  try {
    const [all, oldGameIds] = await Promise.all([getJournal(uid), filedGames(client, uid)]);
    const tx = client.multi();
    queueCopies(tx, uid, all, oldGameIds);
    await tx.exec();
  } catch (error) {
    // Let the next reader try again rather than leave the copies out of step for an hour
    await client.del(copiesRebuiltKey(uid));
    throw error;
  }
}

/**
 * The journal entries of these games, without their images: what the blog needs,
 * read without touching the rest of the journal.
 */
export async function getGamesJournal(gameIds: string[], userId: string): Promise<Omit<JournalEntry, 'image'>[]> {
  if (gameIds.length === 0) return [];
  const client = getRedisClient();
  await ensureJournalCopies(client, userId);
  const pipeline = client.pipeline();
  for (const gameId of gameIds) pipeline.hgetall(gameJournalKey(userId, gameId));
  const results = (await pipeline.exec()) ?? [];
  const entries: Omit<JournalEntry, 'image'>[] = [];
  for (const [error, raw] of results) {
    if (error) throw error;
    entries.push(...parseHashArray((raw ?? {}) as Record<string, string>));
  }
  return entries;
}

// ============================================================
// Analyses — Redis Hash: chess-diary:{uid}:analyses
//   field = gameId, value = JSON analysis object
// ============================================================

export async function getAnalysis(gameId: string, userId?: string): Promise<any | null> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  const data = await client.hget(`chess-diary:${uid}:analyses`, gameId);
  // Accuracy is derived from the moves, so it is worked out here rather than trusted from
  // storage: an analysis saved under an older formula reads as the current one.
  return data ? withCurrentAccuracy(JSON.parse(data)) : null;
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

// Raw, as stored: this feeds getDb, and so backups, which should hold what is saved.
// getAnalysis (one game) is the one that works the accuracy out.
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
// Public blog index — Redis Hash: chess-diary:public:blog
//   field = gameId, value = owner userId
//
// Games are private by default. Clicking "Share" publishes a game's blog
// here, which is the only way an unauthenticated visitor can resolve its
// owner (and therefore read it). Keyed by gameId globally: if two users
// ever share the same chess.com game id, the most recent publisher wins —
// an acceptable edge case for this single-user app.
// ============================================================

const PUBLIC_BLOG_KEY = 'chess-diary:public:blog';

export async function publishBlog(gameId: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  await client.hset(PUBLIC_BLOG_KEY, gameId, uid);
}

// Public read — no auth, by design.
export async function getBlogOwner(gameId: string): Promise<string | null> {
  const client = getRedisClient();
  return client.hget(PUBLIC_BLOG_KEY, gameId);
}

export async function unpublishBlog(gameId: string, userId?: string): Promise<void> {
  const uid = userId || await getUserId();
  const client = getRedisClient();
  // Only the publisher may un-share their own game.
  const owner = await client.hget(PUBLIC_BLOG_KEY, gameId);
  if (owner === uid) await client.hdel(PUBLIC_BLOG_KEY, gameId);
}

// Every published game and who owns it, for the public directory. Public
// read — no auth, by design: it lists only what its authors chose to share.
export async function listPublishedBlogs(): Promise<Array<{ gameId: string; ownerId: string }>> {
  const client = getRedisClient();
  const raw = await client.hgetall(PUBLIC_BLOG_KEY);
  return Object.entries(raw).map(([gameId, ownerId]) => ({ gameId, ownerId }));
}

// ============================================================
// Directory keys — the secret link to an author's directory of shared games
//   chess-diary:{uid}:directory-key    string: the author's current key
//   chess-diary:public:directory-keys  hash:   key → uid, to find whose directory a key opens
//
// Kept apart from the settings hash, which the Settings page rewrites as a whole.
// A key opens a directory only while it is still its author's current key, so a
// replaced key stops working even if its entry in the lookup somehow survives.
// ============================================================

const DIRECTORY_KEYS = 'chess-diary:public:directory-keys';
const directoryKeyOf = (uid: string) => `chess-diary:${uid}:directory-key`;

/** 128 random bits as 22 characters of base64url. */
function newDirectoryKey(): string {
  return randomBytes(16).toString('base64url');
}

/** Whose directory a key opens, or null. Public read, by design: the key is the permission. */
export async function getDirectoryOwner(key: string): Promise<string | null> {
  const client = getRedisClient();
  const uid = await client.hget(DIRECTORY_KEYS, key);
  if (!uid) return null;
  return (await client.get(directoryKeyOf(uid))) === key ? uid : null;
}

/** The author's key, made the first time it is asked for. */
export async function getOrCreateDirectoryKey(userId: string): Promise<string> {
  const client = getRedisClient();
  const own = directoryKeyOf(userId);
  let key = await client.get(own);
  if (!key) {
    // Two first visits at once must agree on one key: only one SET NX wins
    const candidate = newDirectoryKey();
    key = (await client.set(own, candidate, 'NX')) ? candidate : await client.get(own);
    if (!key) throw new Error('Could not create a directory key');
  }
  // Also mends a lookup lost to a partial restore
  await client.hset(DIRECTORY_KEYS, key, userId);
  return key;
}

/** Replace the author's key: the old link stops working at once. */
export async function rotateDirectoryKey(userId: string): Promise<string> {
  const client = getRedisClient();
  const own = directoryKeyOf(userId);
  const old = await client.get(own);
  const key = newDirectoryKey();
  const pipeline = client.pipeline();
  pipeline.set(own, key);
  pipeline.hset(DIRECTORY_KEYS, key, userId);
  if (old) pipeline.hdel(DIRECTORY_KEYS, old);
  await pipeline.exec();
  return key;
}

// ============================================================
// Blog visits — Redis List: chess-diary:{uid}:blog-visits, newest first
//   value = JSON visit (see lib/access-log.ts). Capped at BLOG_VISITS_KEPT,
//   so a flood of requests can't grow it without limit.
// ============================================================

const blogVisitsOf = (uid: string) => `chess-diary:${uid}:blog-visits`;

export async function recordBlogVisit(userId: string, visit: object): Promise<void> {
  const client = getRedisClient();
  const key = blogVisitsOf(userId);
  const pipeline = client.pipeline();
  pipeline.lpush(key, JSON.stringify(visit));
  pipeline.ltrim(key, 0, BLOG_VISITS_KEPT - 1);
  await pipeline.exec();
}

/** The most recent visits, newest first; a line that isn't JSON is skipped. */
export async function getBlogVisits(userId: string, limit = BLOG_VISITS_KEPT): Promise<unknown[]> {
  // LRANGE 0 -1 means "to the end", so asking for none must not reach Redis
  if (limit <= 0) return [];
  const client = getRedisClient();
  const lines = await client.lrange(blogVisitsOf(userId), 0, limit - 1);
  const visits: unknown[] = [];
  for (const line of lines) {
    try { visits.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return visits;
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
