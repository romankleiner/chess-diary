import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getGame: vi.fn(),
  publishBlog: vi.fn(),
  unpublishBlog: vi.fn(),
}));
vi.mock('@/lib/blog-directory-server', () => ({
  clearBlogDirectoryCache: vi.fn(),
}));

import { POST, DELETE } from '@/app/api/games/[id]/share/route';
import { getGame, publishBlog, unpublishBlog } from '@/lib/db';
import { clearBlogDirectoryCache } from '@/lib/blog-directory-server';

const mockGetGame       = vi.mocked(getGame);
const mockPublishBlog   = vi.mocked(publishBlog);
const mockUnpublishBlog = vi.mocked(unpublishBlog);
const mockClearDirectory = vi.mocked(clearBlogDirectoryCache);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(method: 'POST' | 'DELETE', gameId = gameA.id) {
  return new NextRequest(`http://localhost/api/games/${gameId}/share`, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/games/[id]/share', () => {
  it('publishes the game when it exists for the caller', async () => {
    mockGetGame.mockResolvedValue(gameA);
    const res = await POST(makeReq('POST'), params(gameA.id));
    expect(res.status).toBe(200);
    expect((await res.json()).shared).toBe(true);
    expect(mockPublishBlog).toHaveBeenCalledWith(gameA.id);
  });

  it('has the public directory read afresh, so the game is listed at once', async () => {
    mockGetGame.mockResolvedValue(gameA);
    await POST(makeReq('POST'), params(gameA.id));
    expect(mockClearDirectory).toHaveBeenCalledTimes(1);
  });

  it('leaves the directory alone when nothing was published', async () => {
    mockGetGame.mockResolvedValue(null);
    await POST(makeReq('POST'), params('ghost-id'));
    mockGetGame.mockResolvedValue(gameA);
    mockPublishBlog.mockRejectedValue(new Error('redis down'));
    await POST(makeReq('POST'), params(gameA.id));
    expect(mockClearDirectory).not.toHaveBeenCalled();
  });

  it('returns 404 and does not publish when the caller does not own the game', async () => {
    mockGetGame.mockResolvedValue(null);
    const res = await POST(makeReq('POST'), params('ghost-id'));
    expect(res.status).toBe(404);
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });

  it('returns 500 when publishing throws', async () => {
    mockGetGame.mockResolvedValue(gameA);
    mockPublishBlog.mockRejectedValue(new Error('redis down'));
    const res = await POST(makeReq('POST'), params(gameA.id));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/games/[id]/share', () => {
  it('un-shares the game', async () => {
    const res = await DELETE(makeReq('DELETE'), params(gameA.id));
    expect(res.status).toBe(200);
    expect((await res.json()).shared).toBe(false);
    expect(mockUnpublishBlog).toHaveBeenCalledWith(gameA.id);
  });

  it('takes the game out of the public directory at once', async () => {
    await DELETE(makeReq('DELETE'), params(gameA.id));
    expect(mockClearDirectory).toHaveBeenCalledTimes(1);
  });

  it('leaves the directory alone when un-sharing failed', async () => {
    mockUnpublishBlog.mockRejectedValue(new Error('redis down'));
    const res = await DELETE(makeReq('DELETE'), params(gameA.id));
    expect(res.status).toBe(500);
    expect(mockClearDirectory).not.toHaveBeenCalled();
  });
});
