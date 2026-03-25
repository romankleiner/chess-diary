import { auth } from '@clerk/nextjs/server';
import Redis from 'ioredis';

const ADMIN_KEY = 'chess-diary:admin';

// Reuse the same singleton pattern as db-redis.ts
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
  const authResult = await auth();
  const userId = authResult.userId;

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
