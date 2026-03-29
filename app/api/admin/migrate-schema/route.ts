import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { isAdmin } from '@/lib/admin';

/**
 * POST /api/admin/migrate-schema
 *
 * Migrates Redis data from STRING keys (JSON blobs) to HASH keys (per-record).
 * Safe to run multiple times — checks key type before migrating.
 *
 * Key mapping:
 *   chess-diary:{uid}:games    STRING → HASH  (field = gameId)
 *   chess-diary:{uid}:journal  STRING → HASH  (field = entryId)
 *   chess-diary:{uid}:analyses STRING → HASH  (field = gameId)
 *   chess-diary:{uid}:settings STRING → HASH  (field = settingKey)
 */
export async function POST() {
  const { isAdmin: admin } = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!process.env.REDIS_URL) {
    return NextResponse.json({ error: 'REDIS_URL not configured' }, { status: 500 });
  }

  const client = new Redis(process.env.REDIS_URL);
  const results: Record<string, any> = {};

  try {
    // Find all user keys to migrate
    const allKeys = await client.keys('chess-diary:*:games');
    const userIds = allKeys.map(k => {
      const parts = k.split(':');
      return parts[1]; // chess-diary:{uid}:games → uid
    }).filter(uid => uid !== 'admin');

    for (const uid of userIds) {
      const userResult: Record<string, any> = {};

      // --- Games ---
      userResult.games = await migrateRecordKey(
        client,
        `chess-diary:${uid}:games`,
        (parsed: Record<string, any>) => {
          // Record<gameId, game> → entries for HSET
          return Object.entries(parsed).map(([id, val]) => ({
            field: id,
            value: JSON.stringify(val),
          }));
        }
      );

      // --- Journal ---
      userResult.journal = await migrateArrayKey(
        client,
        `chess-diary:${uid}:journal`,
        (parsed: any[]) => {
          // JournalEntry[] → entries for HSET keyed by entry.id
          return parsed.map(entry => ({
            field: String(entry.id),
            value: JSON.stringify(entry),
          }));
        }
      );

      // --- Analyses ---
      userResult.analyses = await migrateRecordKey(
        client,
        `chess-diary:${uid}:analyses`,
        (parsed: Record<string, any>) => {
          return Object.entries(parsed).map(([id, val]) => ({
            field: id,
            value: JSON.stringify(val),
          }));
        }
      );

      // --- Settings ---
      userResult.settings = await migrateRecordKey(
        client,
        `chess-diary:${uid}:settings`,
        (parsed: Record<string, string>) => {
          // Settings values are plain strings, not JSON-wrapped
          return Object.entries(parsed).map(([k, v]) => ({
            field: k,
            value: v,
          }));
        }
      );

      results[uid] = userResult;
    }

    await client.quit();

    return NextResponse.json({
      success: true,
      migratedUsers: userIds.length,
      results,
    });
  } catch (error) {
    await client.quit();
    console.error('[MIGRATE-SCHEMA] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}

interface HashEntry {
  field: string;
  value: string;
}

async function migrateRecordKey(
  client: Redis,
  key: string,
  toEntries: (parsed: Record<string, any>) => HashEntry[]
): Promise<{ status: string; fields?: number }> {
  const keyType = await client.type(key);

  if (keyType === 'hash') {
    const count = await client.hlen(key);
    return { status: 'already_hash', fields: count };
  }

  if (keyType === 'none') {
    return { status: 'no_data' };
  }

  if (keyType !== 'string') {
    return { status: `unexpected_type_${keyType}` };
  }

  // Read the old STRING value
  const raw = await client.get(key);
  if (!raw) return { status: 'empty_string' };

  const parsed = JSON.parse(raw);
  const entries = toEntries(parsed);

  if (entries.length === 0) {
    // Empty object/array — just delete the old key
    await client.del(key);
    return { status: 'migrated', fields: 0 };
  }

  // Atomic DEL + HSET in a pipeline
  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const { field, value } of entries) {
    pipeline.hset(key, field, value);
  }
  await pipeline.exec();

  // Verify
  const newCount = await client.hlen(key);

  return { status: 'migrated', fields: newCount };
}

async function migrateArrayKey(
  client: Redis,
  key: string,
  toEntries: (parsed: any[]) => HashEntry[]
): Promise<{ status: string; fields?: number }> {
  const keyType = await client.type(key);

  if (keyType === 'hash') {
    const count = await client.hlen(key);
    return { status: 'already_hash', fields: count };
  }

  if (keyType === 'none') {
    return { status: 'no_data' };
  }

  if (keyType !== 'string') {
    return { status: `unexpected_type_${keyType}` };
  }

  const raw = await client.get(key);
  if (!raw) return { status: 'empty_string' };

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return { status: 'not_an_array' };
  }

  const entries = toEntries(parsed);

  if (entries.length === 0) {
    await client.del(key);
    return { status: 'migrated', fields: 0 };
  }

  const pipeline = client.pipeline();
  pipeline.del(key);
  for (const { field, value } of entries) {
    pipeline.hset(key, field, value);
  }
  await pipeline.exec();

  const newCount = await client.hlen(key);

  return { status: 'migrated', fields: newCount };
}
