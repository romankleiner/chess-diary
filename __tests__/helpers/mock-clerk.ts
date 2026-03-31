/**
 * Global Clerk auth stub — applied via vitest.config.ts setupFiles.
 * Every test runs as authenticated user 'test-user-123'.
 */
import { vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user-123' }),
  clerkMiddleware: vi.fn(),
  createRouteMatcher: vi.fn(() => () => false),
}));
