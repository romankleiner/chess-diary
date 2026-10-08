/**
 * Recording a view of the blog in its author's visit log. Server only.
 *
 * Only the live site records: development uses the same database as production,
 * so trying the blog out locally would otherwise fill the real log with your own
 * test visits. Set BLOG_VISIT_LOG=1 to record anyway (to try the Visitors page).
 */
import { recordBlogVisit } from '@/lib/db';
import { visitFromHeaders } from '@/lib/access-log';
import type { HeaderSource, VisitedPage, Viewer } from '@/lib/access-log';

export function visitLoggingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production' || env.BLOG_VISIT_LOG === '1';
}

/** Record a view. Never throws: a page must not fail because its visit couldn't be written down. */
export async function recordVisit(ownerId: string, headers: HeaderSource, details: {
  page: VisitedPage;
  gameId?: string | null;
  viewer: Viewer;
}): Promise<void> {
  if (!visitLoggingOn()) return;
  try {
    await recordBlogVisit(ownerId, visitFromHeaders(headers, details));
  } catch (error) {
    console.error('[BLOG-VISITS] Could not record a visit:', error);
  }
}
