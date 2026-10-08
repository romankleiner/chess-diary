import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({ recordBlogVisit: vi.fn() }));

import { recordVisit, visitLoggingOn } from '@/lib/blog-visits-server';
import { recordBlogVisit } from '@/lib/db';

const mockRecord = vi.mocked(recordBlogVisit);
const headers = new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'curl/8.4.0' });

describe('visitLoggingOn', () => {
  it('records on the live site', () => {
    expect(visitLoggingOn({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('does not record in development or on preview deployments, which share the live database', () => {
    expect(visitLoggingOn({})).toBe(false);
    expect(visitLoggingOn({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(visitLoggingOn({ VERCEL_ENV: 'development' })).toBe(false);
    expect(visitLoggingOn({ NODE_ENV: 'production' })).toBe(false);
  });

  it('records anywhere when asked to with BLOG_VISIT_LOG=1, and only then', () => {
    expect(visitLoggingOn({ BLOG_VISIT_LOG: '1' })).toBe(true);
    expect(visitLoggingOn({ BLOG_VISIT_LOG: 'true' })).toBe(false);
    expect(visitLoggingOn({ BLOG_VISIT_LOG: '0' })).toBe(false);
  });
});

describe('recordVisit', () => {
  const saved = { ...process.env };
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => { process.env = { ...saved }; });

  it('writes nothing where logging is off', async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.BLOG_VISIT_LOG;
    await recordVisit('alice', headers, { page: 'directory', viewer: 'visitor' });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('writes the visit, built from the request, to the author’s log', async () => {
    process.env.VERCEL_ENV = 'production';
    await recordVisit('alice', headers, { page: 'game', gameId: '952794945', viewer: 'visitor' });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [owner, visit] = mockRecord.mock.calls[0];
    expect(owner).toBe('alice');
    expect(visit).toMatchObject({ page: 'game', gameId: '952794945', viewer: 'visitor', ip: '203.0.113.7', userAgent: 'curl/8.4.0' });
  });

  it('never fails the page when the log cannot be written', async () => {
    process.env.VERCEL_ENV = 'production';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRecord.mockRejectedValue(new Error('redis down'));
    await expect(recordVisit('alice', headers, { page: 'directory', viewer: 'visitor' })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
