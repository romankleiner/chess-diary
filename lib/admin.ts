import Redis from 'ioredis';
import { currentUserId } from './user-id';

const ADMIN_KEY = 'chess-diary:admin';

// Reuse the same singleton pattern as db.ts
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

/**
 * Check if the current authenticated user is the admin.
 * The first authenticated user to hit this check becomes the admin automatically.
 */
export async function isAdmin(): Promise<{ isAdmin: boolean; userId: string | null }> {
  // The admin is recorded by data id, so a carried-over account stays admin (see lib/user-id.ts)
  const userId = await currentUserId();

  if (!userId) {
    return { isAdmin: false, userId: null };
  }

  const client = getRedisClient();
  const existingAdmin = await client.get(ADMIN_KEY);

  if (!existingAdmin) {
    // First user becomes admin
    await client.set(ADMIN_KEY, userId);
    console.log(`[ADMIN] First user ${userId} registered as admin`);
    return { isAdmin: true, userId };
  }

  return { isAdmin: existingAdmin === userId, userId };
}
